use ethoko_central::{
    auth,
    config::{Config, OtpConfig},
    httpserver::serve_http_server,
    jobs::{memoryqueue::InMemoryQueue, processor::JobProcessor, rootprocessor::RootProcessor},
    router::app_router,
};
use sqlx::postgres::PgPoolOptions;
use std::{collections::HashMap, net::SocketAddr, time::Duration};
use tracing::{Level, error, level_filters::LevelFilter};
use tracing_subscriber::{Layer, layer::SubscriberExt, util::SubscriberInitExt};

use crate::common::{fake_email_service::FakeEmailService, manual_worker::ManualWorker};
mod auth_actions;
mod fake_email_service;
mod manual_worker;

#[allow(unused_imports)]
pub use auth_actions::AuthActions;

#[allow(dead_code)]
pub struct InstanceState {
    pub reqwest_client: reqwest::Client,
    pub server_url: String,
    pub email_service: FakeEmailService,
    pub job_worker: ManualWorker<InMemoryQueue, RootProcessor>,
}

pub struct TestConfigBuilder {
    config: Config,
}

#[allow(dead_code)]
impl TestConfigBuilder {
    pub fn new() -> Self {
        Self {
            config: Config {
                self_url: "http://localhost".into(),
                port: 0,
                database_url: "postgresql://admin:admin@localhost:5433/central".into(),
                log_level: Level::INFO,
                otp_config: OtpConfig {
                    ttl_seconds: 10 * 60,
                    cooldown_seconds: 60,
                },
                global_rate_limit_config: ethoko_central::config::RateLimitConfig {
                    replenishment_per_second: 100,
                    max_burst_size: 1_000,
                },
                auth_rate_limit_config: ethoko_central::config::RateLimitConfig {
                    replenishment_per_second: 100,
                    max_burst_size: 1_000,
                },
                resend_api_key: "test_api_key".into(),
            },
        }
    }

    pub fn build_default() -> Config {
        Self::new().build()
    }

    pub fn with_port(mut self, port: u16) -> Self {
        self.config.port = port;
        self
    }

    pub fn with_database_url(mut self, database_url: &str) -> Self {
        self.config.database_url = database_url.into();
        self
    }

    pub fn with_log_level(mut self, log_level: Level) -> Self {
        self.config.log_level = log_level;
        self
    }

    pub fn with_otp_ttl(mut self, ttl_seconds: u16) -> Self {
        self.config.otp_config.ttl_seconds = ttl_seconds;
        self
    }

    pub fn with_otp_cooldown(mut self, cooldown_seconds: u16) -> Self {
        self.config.otp_config.cooldown_seconds = cooldown_seconds;
        self
    }

    pub fn with_auth_rate_limit(
        mut self,
        replenishment_per_second: u64,
        max_burst_size: u32,
    ) -> Self {
        self.config.auth_rate_limit_config.replenishment_per_second = replenishment_per_second;
        self.config.auth_rate_limit_config.max_burst_size = max_burst_size;
        self
    }

    pub fn build(self) -> Config {
        self.config
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

    let email_service = FakeEmailService::default();

    let users_notifier = auth::AuthNotifierImpl::new(job_queue.clone());
    let auth_repository = auth::PsqlAuthRepository::new(pool);
    let auth_service = auth::AuthServiceImpl::new(
        auth_repository.clone(),
        users_notifier,
        config.otp_config.clone(),
    );
    let users_job_processor = auth::AuthJobProcessor::new(
        auth_repository.clone(),
        email_service.clone(),
        config.otp_config.clone(),
    );

    let job_worker_queue = job_queue.clone();
    let job_worker_users_job_processor = users_job_processor.clone();
    let root_processor = RootProcessor::new(HashMap::from([(
        auth::AUTH_JOB_TOPIC.to_string(),
        Box::new(job_worker_users_job_processor) as Box<dyn JobProcessor>,
    )]));
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

    let (app_router, _) = app_router(
        config.global_rate_limit_config.clone(),
        config.auth_rate_limit_config.clone(),
        auth_service,
    )
    .unwrap();
    tokio::spawn(async move {
        if let Err(e) = serve_http_server(listener, app_router).await {
            error!("Error during http server graceful shutdown: {e:?}");
        }
    });

    Ok(InstanceState {
        server_url,
        job_worker,
        email_service,
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
