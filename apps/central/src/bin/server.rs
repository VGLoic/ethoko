use dotenvy::dotenv;
use ethoko_central::{
    config::Config,
    httpserver::serve_http_server,
    jobs::{self, processor::JobProcessor},
    users::{self, notifier::USERS_JOB_TOPIC},
};
use sqlx::postgres::PgPoolOptions;
use std::{collections::HashMap, time::Duration};
use tokio_util::sync::CancellationToken;
use tracing::{error, info, level_filters::LevelFilter};
use tracing_subscriber::{Layer, layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    if let Err(err) = dotenv()
        && !err.not_found()
    {
        return Err(anyhow::Error::new(err).context("Error while loading .env file"));
    }

    let config = match Config::parse_from_env() {
        Ok(c) => c,
        Err(errors) => {
            return Err(anyhow::anyhow!(
                "Failed to parse environment variables for configuration with errors: {}",
                errors
                    .into_iter()
                    .map(|e| e.to_string())
                    .collect::<Vec<String>>()
                    .join(", ")
            ));
        }
    };

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .with_filter(Into::<LevelFilter>::into(config.log_level)),
        )
        .init();

    let pool = match PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&config.database_url)
        .await
    {
        Ok(c) => c,
        Err(e) => {
            return Err(anyhow::Error::new(e).context("Failed to establish connection to database"));
        }
    };

    if let Err(e) = sqlx::migrate!("./migrations").run(&pool).await {
        return Err(anyhow::Error::new(e).context("Failed to run database migrations"));
    };

    info!("Successfully ran migrations");

    let cancellation_token = CancellationToken::new();
    let job_queue = jobs::psqlqueue::PsqlQueue::new(3, pool.clone());

    let job_queue_token = cancellation_token.clone();
    let job_queue_runner = job_queue.clone();
    let job_queue_handle = tokio::spawn(async move {
        if let Err(e) = job_queue_runner.run(job_queue_token, 5).await {
            error!("Job queue error: {e:?}")
        }
        info!("Gracefully exiting job queue handle")
    });

    let users_notifier = users::notifier::UsersNotifierImpl::new(job_queue.clone());
    let users_job_processor = users::notifier::job_processor::UsersJobProcessor;
    let users_repository = users::repository::PsqlAccountsRepository::new(pool);
    let users_service = users::service::UsersServiceImpl::new(users_repository, users_notifier);

    let job_worker_queue = job_queue.clone();
    let job_worker_token = cancellation_token.clone();
    let job_worker_handle = tokio::spawn(async {
        let root_processor = jobs::rootprocessor::RootProcessor::new(HashMap::from([(
            USERS_JOB_TOPIC.to_string(),
            Box::new(users_job_processor) as Box<dyn JobProcessor>,
        )]));
        let worker = jobs::polling_worker::Worker::new(job_worker_queue, root_processor, 1_000);

        if let Err(e) = worker.run(job_worker_token).await {
            error!("Worker error: {e:?}")
        }
        info!("Gracefully exiting job worker handle")
    });

    let addr = format!("0.0.0.0:{}", config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await.map_err(|err| {
        anyhow::Error::new(err).context(format!(
            "Error while binding the TCP listener to address {addr}"
        ))
    })?;

    info!(
        "Successfully bind the TCP listener to address {}\n",
        listener.local_addr().unwrap()
    );

    if let Err(e) = serve_http_server(listener, users_service).await {
        error!("Error during http server graceful shutdown: {e:?}");
    }

    info!("Cancelling other app handles");

    cancellation_token.cancel();

    if let Err(e) = job_worker_handle.await {
        error!("Error during job worker handler graceful shutdown: {e:?}");
    }
    if let Err(e) = job_queue_handle.await {
        error!("Error during job queue handler graceful shutdown: {e:?}");
    }

    Ok(())
}
