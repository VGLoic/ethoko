use ethoko_central::{
    auth,
    config::{Config, OauthClientConfig, OtpConfig},
    httpserver::serve_http_server,
    jobs::{memoryqueue::InMemoryQueue, rootprocessor::RootProcessor},
    router::app_router,
};
use sqlx::postgres::PgPoolOptions;
use std::{collections::HashMap, net::SocketAddr, time::Duration};
use tracing::{Level, error};

use crate::common::{
    fake_email_service::FakeEmailService, fake_github_client::FakeGithubClient,
    fake_oauth_client::FakeOauthClient, manual_worker::ManualWorker,
};
mod auth_actions;
mod fake_email_service;
mod fake_github_client;
mod fake_oauth_client;
mod manual_worker;
#[path = "../test_tracing.rs"]
mod test_tracing;

#[allow(unused_imports)]
pub use auth_actions::{
    AuthActions, central_ui_bff_principal_headers, central_ui_bff_with_user_principal_headers,
};

#[allow(dead_code)]
pub struct InstanceState {
    pub reqwest_client: reqwest::Client,
    pub server_url: String,
    pub email_service: FakeEmailService,
    pub github_client: FakeGithubClient,
    pub github_oauth_client: FakeOauthClient,
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
                web_app_url: "http://localhost:5173".into(),
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
                central_ui_bff_shared_secret: "test-central-ui-bff-shared-secret".into(),
                github_oauth_client_config: OauthClientConfig {
                    client_id: oauth2::ClientId::new("test-client-id".to_string()),
                    client_secret: oauth2::ClientSecret::new("test-client-secret".to_string()),
                    callback_url: oauth2::RedirectUrl::new("http://localhost/callback".to_string())
                        .unwrap(),
                    auth_url: oauth2::AuthUrl::new("http://localhost/auth".to_string()).unwrap(),
                    auth_token_url: oauth2::TokenUrl::new(
                        "http://localhost/auth/token".to_string(),
                    )
                    .unwrap(),
                },
                oauth_transaction_ttl_seconds: 600, // default to 10 minutes
                github_api_url: "https://api.github.com".into(),
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

    pub fn with_oauth_transaction_ttl_seconds(mut self, ttl_seconds: u16) -> Self {
        self.config.oauth_transaction_ttl_seconds = ttl_seconds;
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
    test_tracing::init().map_err(anyhow::Error::msg)?;

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
    let github_client = FakeGithubClient::default();

    let auth_oauth_github_client_adapter = FakeOauthClient::default();
    let auth = auth::Auth::compose(
        pool,
        job_queue.clone(),
        email_service.clone(),
        github_client.clone(),
        auth_oauth_github_client_adapter.clone(),
        config.otp_config.clone(),
        config.oauth_transaction_ttl_seconds,
        config.central_ui_bff_shared_secret.clone(),
    );

    let root_processor = RootProcessor::new(HashMap::from([auth.job_registration()]));
    let job_worker = ManualWorker::new(job_queue, root_processor);

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
        auth,
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
        github_client,
        github_oauth_client: auth_oauth_github_client_adapter,
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
