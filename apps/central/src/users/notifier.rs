use chrono::Utc;
use tracing::info;

use crate::{
    jobs::{
        job,
        queue::{Queue, QueueError},
    },
    users::models::{auth_credential::AuthCredential, email_signup::EmailSignupError, user::User},
};

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
pub struct UsersNotifierImpl<Q: Queue> {
    queue: Q,
}

impl<Q: Queue> UsersNotifierImpl<Q> {
    pub fn new(queue: Q) -> Self {
        Self { queue }
    }
}

#[async_trait::async_trait]
impl<Q: Queue> UsersNotifier for UsersNotifierImpl<Q> {
    async fn user_signed_up_with_email(
        &self,
        user: &User,
        _auth_credential: &AuthCredential,
    ) -> Result<(), EmailSignupError> {
        info!(
            "sending notification for user signed up with email: {}",
            user.email
        );
        let job = job::Job::new(job::JobPayload::Bob, Utc::now());
        self.queue.enqueue(job)?;
        Ok(())
    }
}

impl From<QueueError> for EmailSignupError {
    fn from(value: QueueError) -> Self {
        match value {
            QueueError::Unknown(e) => EmailSignupError::Unknown(e),
        }
    }
}
