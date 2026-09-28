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
        notifier::jobs::{AuthJob, SendEmailVerificationOtpPayload},
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

    /// Triggers a notification when user logged in
    /// # Errors
    /// * `LoginEmailError::Unknown` for any errors that may occur during the process.
    async fn user_logged_in(&self, user: &User) -> Result<(), LoginEmailError>;
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
    async fn user_signed_up_with_email(
        &self,
        user: &User,
        _auth_credential: &AuthCredential,
    ) -> Result<(), SignupEmailError> {
        debug!(
            event = "auth.notification.enqueue_started",
            notification_type = "email_verification_otp",
            user_id = %user.id,
            "Enqueuing signup notification"
        );
        let job = JobRequest::new(
            AUTH_JOB_TOPIC.to_string(),
            AuthJob::SendEmailVerificationOtp(SendEmailVerificationOtpPayload::new(user)),
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
            user_id = %user.id,
            "Enqueued signup notification"
        );
        Ok(())
    }

    async fn user_verified_email(&self, user: &User) -> Result<(), VerifyEmailError> {
        debug!(
            event = "auth.notification.skipped",
            notification_type = "user_verified_email",
            user_id = %user.id,
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
            user_id = %user.id,
            "Enqueuing resend verification OTP notification"
        );

        let job = JobRequest::new(
            AUTH_JOB_TOPIC.to_string(),
            AuthJob::SendEmailVerificationOtp(SendEmailVerificationOtpPayload::new(user)),
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
            user_id = %user.id,
            "Enqueued resend verification OTP notification"
        );
        Ok(())
    }

    async fn user_logged_in(&self, user: &User) -> Result<(), LoginEmailError> {
        debug!(
            event = "auth.notification.skipped",
            notification_type = "user_logged_in",
            user_id = %user.id,
            "No notification action required for login event"
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
