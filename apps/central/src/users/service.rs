use crate::users::{
    models::{
        auth_credential::AuthCredential,
        email_signup::{EmailSignupError, EmailSignupRequest},
        user::User,
    },
    repository::UsersRepository,
};

#[async_trait::async_trait]
pub trait UsersService: Send + Sync + 'static {
    /// Registers a new user with the provided email, handle and password hash.
    /// - A new user is created with the provided email and handle, the email is marked as not verified.
    /// - An `auth_credential` is created for the user with the provided password hash.
    /// # Errors
    /// * `EmailSignupError::EmailAlreadyExists` if the email is already registered.
    /// * `EmailSignupError::HandleAlreadyExists` if the handle is already taken.
    /// * `EmailSignupError::Unknown` for any other errors that may occur during the process.
    async fn signup_with_email(
        &self,
        request: EmailSignupRequest,
    ) -> Result<(User, AuthCredential), EmailSignupError>;
}

pub struct UsersServiceImpl<R: UsersRepository> {
    repository: R,
}

impl<R: UsersRepository> UsersServiceImpl<R> {
    pub fn new(repository: R) -> Self {
        Self { repository }
    }
}

#[async_trait::async_trait]
impl<R: UsersRepository> UsersService for UsersServiceImpl<R> {
    async fn signup_with_email(
        &self,
        request: EmailSignupRequest,
    ) -> Result<(User, AuthCredential), EmailSignupError> {
        self.repository.signup_with_email(request).await
    }
}
