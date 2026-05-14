use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    newtypes::{
        email::{Email, EmailError},
        handle::{Handle, HandleError},
        password::{Password, PasswordError},
    },
    users::password_hasher,
};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignupEmailBody {
    pub email: String,
    pub handle: String,
    pub password: String,
}

pub struct EmailSignupRequest {
    pub email: Email,
    pub handle: Handle,
    pub password_hash: String,
}

#[derive(Debug, Error)]
pub enum EmailSignupRequestError {
    #[error("Invalid email")]
    InvalidEmail(EmailError),
    #[error("Invalid handle")]
    InvalidHandle(HandleError),
    #[error("Invalid password")]
    InvalidPassword(PasswordError),
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}

impl EmailSignupRequest {
    /// Creates a new `EmailSignupRequest` after validating the formats and hashing the password.
    ///
    /// # Errors
    /// `EmailSignupRequestError::InvalidEmail` if the email format is invalid.
    /// `EmailSignupRequestError::InvalidHandle` if the handle format is invalid
    /// `EmailSignupRequestError::InvalidPassword` if the password format is invalid
    /// `EmailSignupRequestError::Unknown` for any other errors that may occur during the process.
    pub fn new(
        email: String,
        handle: String,
        password: String,
    ) -> Result<Self, EmailSignupRequestError> {
        let email = Email::new(&email).map_err(EmailSignupRequestError::InvalidEmail)?;
        let handle = Handle::new(&handle).map_err(EmailSignupRequestError::InvalidHandle)?;
        let password =
            Password::new(&password).map_err(EmailSignupRequestError::InvalidPassword)?;

        let password_hash = password_hasher::hash_password(&password)?;

        Ok(Self {
            email,
            handle,
            password_hash,
        })
    }
}

#[derive(Debug, Error)]
pub enum EmailSignupError {
    #[error("Email {0} already exists")]
    EmailAlreadyExists(String),
    #[error("Handle {0} already exists")]
    HandleAlreadyExists(String),
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}

#[cfg(test)]
mod tests {
    use fake::{Fake, Faker};

    use super::*;

    #[test]
    fn test_valid_email_signup_request() {
        let email = Faker.fake::<Email>();
        let handle = Faker.fake::<Handle>();
        let password = Faker.fake::<Password>();

        let result = EmailSignupRequest::new(
            email.to_string(),
            handle.to_string(),
            password.as_str().to_string(),
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_invalid_email_signup_request() {
        let invalid_email = "invalid-email".to_string();
        let handle = Faker.fake::<Handle>();
        let password = Faker.fake::<Password>();
        let result = EmailSignupRequest::new(
            invalid_email,
            handle.to_string(),
            password.as_str().to_string(),
        );
        assert!(matches!(
            result,
            Err(EmailSignupRequestError::InvalidEmail(_))
        ));
    }

    #[test]
    fn test_invalid_handle_signup_request() {
        let email = Faker.fake::<Email>();
        let invalid_handle = "invalid@handle".to_string();
        let password = Faker.fake::<Password>();
        let result = EmailSignupRequest::new(
            email.to_string(),
            invalid_handle,
            password.as_str().to_string(),
        );
        assert!(matches!(
            result,
            Err(EmailSignupRequestError::InvalidHandle(_))
        ));
    }

    #[test]
    fn test_invalid_password_signup_request() {
        let email = Faker.fake::<Email>();
        let handle = Faker.fake::<Handle>();
        let invalid_password = "invalid-password".to_string();
        let result =
            EmailSignupRequest::new(email.to_string(), handle.to_string(), invalid_password);
        assert!(matches!(
            result,
            Err(EmailSignupRequestError::InvalidPassword(_))
        ));
    }
}
