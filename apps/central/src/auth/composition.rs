use std::sync::Arc;

use axum::Router;
use sqlx::PgPool;

use super::{
    acls::{github::AuthGithubAdapter, oauth::AuthOauthClientPort},
    notifier::{AUTH_JOB_TOPIC, AuthNotifierImpl, job_processor::AuthJobProcessor},
    repository::PsqlAuthRepository,
    router,
    service::AuthServiceImpl,
    state::AuthState,
};
use crate::{
    clients::github::GithubClient,
    config::{OtpConfig, RateLimitConfig},
    externalcom::email::EmailService,
    jobs::{job::Job, processor::JobProcessor, queue::Queue},
    router::IpRateLimiter,
};

/// The composed auth context, owning its HTTP state and background processor.
pub struct Auth {
    state: AuthState,
    job_processor: Arc<dyn JobProcessor>,
}

impl Auth {
    /// Assembles auth without performing I/O or fallible configuration.
    #[allow(clippy::too_many_arguments)]
    pub fn compose(
        pool: PgPool,
        job_queue: impl Queue,
        email_service: impl EmailService,
        github_client: impl GithubClient,
        oauth_client: impl AuthOauthClientPort,
        otp_config: OtpConfig,
        oauth_transaction_ttl_seconds: u16,
        central_ui_bff_shared_secret: String,
        password_reset_cooldown_seconds: u16,
    ) -> Self {
        let repository = PsqlAuthRepository::new(pool);
        let notifier = AuthNotifierImpl::new(job_queue);
        let github_adapter = AuthGithubAdapter::new(github_client);
        let service = AuthServiceImpl::new(
            repository.clone(),
            notifier,
            otp_config.clone(),
            oauth_client,
            oauth_transaction_ttl_seconds,
            github_adapter,
            password_reset_cooldown_seconds,
        );
        let job_processor = AuthJobProcessor::new(
            repository,
            email_service,
            otp_config,
            password_reset_cooldown_seconds,
        );

        Self {
            state: AuthState {
                auth_service: Arc::new(service),
                central_ui_bff_shared_secret: Arc::new(central_ui_bff_shared_secret),
            },
            job_processor: Arc::new(job_processor),
        }
    }

    /// Builds an independent auth router with its own rate limiter for cleanup.
    /// Returns an error if the rate-limit configuration is invalid.
    pub fn router<S>(
        &self,
        rate_limit_config: RateLimitConfig,
    ) -> Result<(Router<S>, IpRateLimiter), anyhow::Error>
    where
        S: Clone + Send + Sync + 'static,
    {
        router::router(self.state.clone(), rate_limit_config)
    }

    /// Returns an owned topic/processor pair, sharing this context's processor.
    /// Repeated registrations do not consume the context or clone its dependencies.
    pub fn job_registration(&self) -> (String, Box<dyn JobProcessor>) {
        (
            AUTH_JOB_TOPIC.to_string(),
            Box::new(SharedAuthJobProcessor(self.job_processor.clone())),
        )
    }
}

struct SharedAuthJobProcessor(Arc<dyn JobProcessor>);

#[async_trait::async_trait]
impl JobProcessor for SharedAuthJobProcessor {
    /// Forwards processing to the shared auth processor, preserving its errors.
    async fn process_job(&self, job: &Job) -> Result<(), anyhow::Error> {
        self.0.process_job(job).await
    }
}
