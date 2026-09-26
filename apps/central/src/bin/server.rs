use dotenvy::dotenv;
use ethoko_central::{
    auth,
    config::Config,
    externalcom::email::ResendEmailService,
    httpserver::serve_http_server,
    jobs::{self, processor::JobProcessor},
    router::app_router,
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

    let email_service =
        ResendEmailService::new(config.web_app_url.clone(), config.resend_api_key.clone());

    let auth_repository = auth::PsqlAuthRepository::new(pool);
    let auth_notifier = auth::AuthNotifierImpl::new(job_queue.clone());
    let auth_service = auth::AuthServiceImpl::new(
        auth_repository.clone(),
        auth_notifier,
        config.otp_config.clone(),
    );
    let auth_job_processor = auth::AuthJobProcessor::new(
        auth_repository.clone(),
        email_service,
        config.otp_config.clone(),
    );

    let job_worker_queue = job_queue.clone();
    let job_worker_token = cancellation_token.clone();
    let job_worker_handle = tokio::spawn(async {
        let root_processor = jobs::rootprocessor::RootProcessor::new(HashMap::from([(
            auth::AUTH_JOB_TOPIC.to_string(),
            Box::new(auth_job_processor) as Box<dyn JobProcessor>,
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

    let (app_router, ip_rate_limiters) = app_router(
        config.global_rate_limit_config.clone(),
        config.auth_rate_limit_config.clone(),
        auth_service,
    )
    .map_err(|e| e.context("Error while building the application router"))?;

    let limiter_cleanup_token = cancellation_token.clone();
    let limiter_cleanup_task = tokio::spawn(async move {
        if let Err(e) = ip_rate_limiters
            .run_cleanup_old_routine(limiter_cleanup_token)
            .await
        {
            error!("Error during limiter cleanup task: {e:?}");
        }
        info!("Gracefully exiting limiter cleanup task")
    });

    if let Err(e) = serve_http_server(listener, app_router).await {
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
    if let Err(e) = limiter_cleanup_task.await {
        error!("Error during limiter cleanup task graceful shutdown: {e:?}");
    }

    Ok(())
}
