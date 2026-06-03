use ethoko_central::{
    config::Config,
    httpserver::serve_http_server,
    jobs::{processor::RootProcessor, queue::InMemoryQueue},
    users,
};
use sqlx::postgres::PgPoolOptions;
use std::{net::SocketAddr, time::Duration};
use tracing::{Level, error, level_filters::LevelFilter};
use tracing_subscriber::{Layer, layer::SubscriberExt, util::SubscriberInitExt};

use crate::common::{manual_worker::ManualWorker, users_processor::FakeUserJobProcessor};
mod manual_worker;
mod users_processor;

#[allow(dead_code)]
pub struct InstanceState {
    pub reqwest_client: reqwest::Client,
    pub server_url: String,
    pub users_processor: FakeUserJobProcessor,
    pub job_worker: ManualWorker<InMemoryQueue, RootProcessor<FakeUserJobProcessor>>,
}

pub fn default_test_config() -> Config {
    Config {
        port: 0,
        database_url: "postgresql://admin:admin@localhost:5433/central".into(),
        log_level: Level::INFO,
    }
}

pub async fn setup_instance(config: &Config) -> Result<InstanceState, anyhow::Error> {
    let _ = tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer().with_filter(LevelFilter::from_level(config.log_level)),
        )
        .try_init();

    let pool = match PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&config.database_url)
        .await
    {
        Ok(c) => c,
        Err(e) => {
            let err = format!("Failed to establish connection to database {e}");
            error!(err);
            return Err(anyhow::anyhow!(err));
        }
    };

    if let Err(e) = sqlx::migrate!("./migrations").run(&pool).await {
        let err = format!("Failed to run database migrations: {e}");
        error!(err);
        return Err(anyhow::anyhow!(err));
    };

    let job_queue = InMemoryQueue::new(2);

    let users_notifier = users::notifier::UsersNotifierImpl::new(job_queue.clone());
    let users_job_processor = FakeUserJobProcessor::default();
    let users_repository = users::repository::PsqlAccountsRepository::new(pool);
    let users_service = users::service::UsersServiceImpl::new(users_repository, users_notifier);

    let job_worker_queue = job_queue.clone();
    let job_worker_users_job_processor = users_job_processor.clone();
    let root_processor = RootProcessor::new(Some(job_worker_users_job_processor));
    let job_worker = ManualWorker::new(job_worker_queue, root_processor);

    let port = config.port;

    let listener = if port == 0 {
        bind_listener_to_free_port().await?
    } else {
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        tokio::net::TcpListener::bind(&addr).await.map_err(|err| {
            anyhow::anyhow!("Failed to bind the TCP listener to address {addr}: {err}")
        })?
    };

    let server_url = format!(
        "http://{}:{}",
        listener.local_addr().unwrap().ip(),
        listener.local_addr().unwrap().port()
    );

    tokio::spawn(async move {
        if let Err(e) = serve_http_server(listener, users_service).await {
            error!("Error during http server graceful shutdown: {e:?}");
        }
    });

    Ok(InstanceState {
        server_url,
        job_worker,
        users_processor: users_job_processor,
        reqwest_client: reqwest::Client::new(),
    })
}

async fn bind_listener_to_free_port() -> Result<tokio::net::TcpListener, anyhow::Error> {
    for port in 51_000..60_000 {
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        match tokio::net::TcpListener::bind(&addr).await {
            Ok(listener) => return Ok(listener),
            Err(_) => continue,
        }
    }
    Err(anyhow::anyhow!(
        "No free port found in the range 51000-60000"
    ))
}
