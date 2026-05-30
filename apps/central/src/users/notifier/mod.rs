use chrono::Utc;
use tracing::info;

use crate::{
    jobs as generic_jobs,
    users::{
        models::{auth_credential::AuthCredential, email_signup::EmailSignupError, user::User},
        notifier::jobs::{DummyJobPayload, UsersJob},
    },
};

pub mod job_processor;
pub mod jobs;

#[async_trait::async_trait]
/// Defines the UsersNotifier trait for users related notifications
pub trait UsersNotifier: Send + Sync + 'static {
    /// Triggers a notification when user signed up with email
    /// # Errors
    /// * `EmailSignupError::Unknown` for any errors that may occur during the process.
    async fn user_signed_up_with_email(
        &self,
        user: &User,
        auth_credential: &AuthCredential,
    ) -> Result<(), EmailSignupError>;
}

#[derive(Clone)]
pub struct UsersNotifierImpl<Q: generic_jobs::queue::Queue> {
    queue: Q,
}

impl<Q: generic_jobs::queue::Queue> UsersNotifierImpl<Q> {
    pub fn new(queue: Q) -> Self {
        Self { queue }
    }
}

#[async_trait::async_trait]
impl<Q: generic_jobs::queue::Queue> UsersNotifier for UsersNotifierImpl<Q> {
    async fn user_signed_up_with_email(
        &self,
        user: &User,
        _auth_credential: &AuthCredential,
    ) -> Result<(), EmailSignupError> {
        info!(
            "sending notification for user signed up with email: {}",
            user.email
        );
        let job = generic_jobs::job::Job::new(
            UsersJob::DummyJob(DummyJobPayload::new(user.id)),
            Utc::now(),
        )?;
        self.queue.enqueue(job)?;
        Ok(())
    }
}

impl From<generic_jobs::queue::QueueError> for EmailSignupError {
    fn from(value: generic_jobs::queue::QueueError) -> Self {
        match value {
            generic_jobs::queue::QueueError::Unknown(e) => EmailSignupError::Unknown(e),
        }
    }
}
