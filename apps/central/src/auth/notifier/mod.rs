use chrono::Utc;
use tracing::debug;

use crate::{
    auth::{
        models::{
            auth_credential::AuthCredential,
            requests::{
                login_email::LoginEmailError, resend_verification_otp::ResendVerificationOtpError,
                signup_email::SignupEmailError, verify_email::VerifyEmailError,
            },
            user::User,
        },
        notifier::jobs::{AuthEmailDeliveryPayload, AuthJob},
        requests::login_github_callback::LoginGithubCallbackError,
    },
    jobs::{
        job::JobRequest,
        queue::{Queue, QueueError},
    },
};

pub mod job_processor;
pub mod jobs;

pub const AUTH_JOB_TOPIC: &str = "auth";

#[async_trait::async_trait]
/// Defines the AuthNotifier trait for auth related notifications
pub trait AuthNotifier: Send + Sync + 'static {
    /// Enqueues password recovery delivery; returns serialization or queue errors.
    async fn user_requested_password_reset(&self, user: &User) -> Result<(), anyhow::Error>;
    /// Triggers a notification when user signed up with email
    /// # Errors
    /// * `SignupEmailError::Unknown` for any errors that may occur during the process.
    async fn user_signed_up_with_email(
        &self,
        user: &User,
        auth_credential: &AuthCredential,
    ) -> Result<(), SignupEmailError>;

    /// Triggers a notification when user verified their email
    /// # Errors
    /// * `VerifyEmailError::Unknown` for any errors that may occur during the process
    async fn user_verified_email(&self, user: &User) -> Result<(), VerifyEmailError>;

    /// Triggers a notification when user requested to resend verification OTP
    /// # Errors
    /// * `ResendVerificationOtpError::Unknown` for any errors that may occur during the process.
    async fn user_requested_resend_verification_otp(
        &self,
        user: &User,
    ) -> Result<(), ResendVerificationOtpError>;

    /// Triggers a notification when user logged in with email
    /// # Errors
    /// * `LoginEmailError::Unknown` for any errors that may occur during the process.
    async fn user_logged_in_with_email(&self, user: &User) -> Result<(), LoginEmailError>;

    /// Triggers a notification when user signed up with Github
    /// # Errors
    /// * `LoginGithubCallbackError::Unknown` for any errors that may occur during the process.
    async fn user_signed_up_with_github(
        &self,
        user: &User,
        auth_credential: &AuthCredential,
    ) -> Result<(), LoginGithubCallbackError>;

    /// Triggers a notification when user logged in with Github
    /// # Errors
    /// * `LoginGithubCallbackError::Unknown` for any errors that may occur during the process.
    async fn user_logged_in_with_github(&self, user: &User)
    -> Result<(), LoginGithubCallbackError>;
}

#[derive(Clone)]
pub struct AuthNotifierImpl<Q: Queue> {
    queue: Q,
}

impl<Q: Queue> AuthNotifierImpl<Q> {
    pub fn new(queue: Q) -> Self {
        Self { queue }
    }
}

#[async_trait::async_trait]
impl<Q: Queue> AuthNotifier for AuthNotifierImpl<Q> {
    async fn user_requested_password_reset(&self, user: &User) -> Result<(), anyhow::Error> {
        let job = JobRequest::new(
            AUTH_JOB_TOPIC.to_string(),
            AuthJob::SendPasswordReset(AuthEmailDeliveryPayload::new(user)),
        )?
        .with_max_retries(3)
        .with_scheduled_at(Utc::now());
        self.queue
            .enqueue(job)
            .await
            .map_err(|QueueError::Unknown(error)| error)?;
        Ok(())
    }
    async fn user_signed_up_with_email(
        &self,
        user: &User,
        _auth_credential: &AuthCredential,
    ) -> Result<(), SignupEmailError> {
        debug!(
            event = "auth.notification.enqueue_started",
            notification_type = "email_verification_otp",
            user_id = %user.id(),
            "Enqueuing signup with email notification"
        );
        let job = JobRequest::new(
            AUTH_JOB_TOPIC.to_string(),
            AuthJob::SendEmailVerificationOtp(AuthEmailDeliveryPayload::new(user)),
        )?
        .with_max_retries(3)
        .with_scheduled_at(Utc::now());
        self.queue.enqueue(job).await.map_err(|e| match e {
            QueueError::Unknown(err) => SignupEmailError::Unknown(
                err.context("Error enqueuing job for user signed up with email"),
            ),
        })?;

        debug!(
            event = "auth.notification.enqueued",
            notification_type = "email_verification_otp",
            user_id = %user.id(),
            "Enqueued signup with email notification"
        );
        Ok(())
    }

    async fn user_verified_email(&self, user: &User) -> Result<(), VerifyEmailError> {
        debug!(
            event = "auth.notification.skipped",
            notification_type = "user_verified_email",
            user_id = %user.id(),
            "No notification action required for verified email event"
        );
        Ok(())
    }

    async fn user_requested_resend_verification_otp(
        &self,
        user: &User,
    ) -> Result<(), ResendVerificationOtpError> {
        debug!(
            event = "auth.notification.enqueue_started",
            notification_type = "email_verification_otp",
            user_id = %user.id(),
            "Enqueuing resend verification OTP notification"
        );

        let job = JobRequest::new(
            AUTH_JOB_TOPIC.to_string(),
            AuthJob::SendEmailVerificationOtp(AuthEmailDeliveryPayload::new(user)),
        )?
        .with_max_retries(3)
        .with_scheduled_at(Utc::now());

        self.queue.enqueue(job).await.map_err(|e| match e {
            QueueError::Unknown(err) => ResendVerificationOtpError::Unknown(
                err.context("Error enqueuing job for user requested resend verification OTP"),
            ),
        })?;

        debug!(
            event = "auth.notification.enqueued",
            notification_type = "email_verification_otp",
            user_id = %user.id(),
            "Enqueued resend verification OTP notification"
        );
        Ok(())
    }

    async fn user_logged_in_with_email(&self, user: &User) -> Result<(), LoginEmailError> {
        debug!(
            event = "auth.notification.skipped",
            notification_type = "user_logged_in_with_email",
            user_id = %user.id(),
            "No notification action required for login with email event"
        );
        Ok(())
    }

    async fn user_signed_up_with_github(
        &self,
        user: &User,
        _auth_credential: &AuthCredential,
    ) -> Result<(), LoginGithubCallbackError> {
        if user.email_verified() {
            debug!(
                event = "auth.notification.skipped",
                notification_type = "user_signed_up_with_github",
                user_id = %user.id(),
                "No notification action required for signup with GitHub event for verified users"
            );
            return Ok(());
        }
        debug!(
            event = "auth.notification.enqueue_started",
            notification_type = "email_verification_otp",
            user_id = %user.id(),
            "Enqueuing signup with GitHub notification"
        );
        let job = JobRequest::new(
            AUTH_JOB_TOPIC.to_string(),
            AuthJob::SendEmailVerificationOtp(AuthEmailDeliveryPayload::new(user)),
        )?
        .with_max_retries(3)
        .with_scheduled_at(Utc::now());
        self.queue.enqueue(job).await.map_err(|e| match e {
            QueueError::Unknown(err) => LoginGithubCallbackError::Unknown(
                err.context("Error enqueuing job for user signed up with GitHub"),
            ),
        })?;

        debug!(
            event = "auth.notification.enqueued",
            notification_type = "email_verification_otp",
            user_id = %user.id(),
            "Enqueued signup with GitHub notification"
        );
        Ok(())
    }

    async fn user_logged_in_with_github(
        &self,
        user: &User,
    ) -> Result<(), LoginGithubCallbackError> {
        debug!(
            event = "auth.notification.skipped",
            notification_type = "user_logged_in_with_github",
            user_id = %user.id(),
            "No notification action required for login with Github event"
        );
        Ok(())
    }
}

impl From<QueueError> for SignupEmailError {
    fn from(value: QueueError) -> Self {
        match value {
            QueueError::Unknown(e) => SignupEmailError::Unknown(e),
        }
    }
}
