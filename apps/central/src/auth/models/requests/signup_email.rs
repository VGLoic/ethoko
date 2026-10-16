use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    auth::{models::user::User, password_hasher},
    newtypes::{
        email::{Email, EmailError},
        password::{Password, PasswordError},
        password_hash::PasswordHash,
    },
};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpSignupEmailBody {
    pub email: String,
    pub password: String,
}

pub(in crate::auth) struct SignupEmailRequest {
    pub email: Email,
    pub password_hash: PasswordHash,
}

#[derive(Debug, Error)]
pub(in crate::auth) enum SignupEmailRequestError {
    #[error("Invalid email")]
    InvalidEmail(EmailError),
    #[error("Invalid password")]
    InvalidPassword(PasswordError),
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}

impl SignupEmailRequest {
    /// Creates a new `SignupEmailRequest` after validating the formats and hashing the password.
    ///
    /// # Errors
    /// `SignupEmailRequestError::InvalidEmail` if the email format is invalid.
    /// `SignupEmailRequestError::InvalidPassword` if the password format is invalid
    /// `SignupEmailRequestError::Unknown` for any other errors that may occur during the process.
    pub fn new(email: String, password: String) -> Result<Self, SignupEmailRequestError> {
        let email = Email::new(&email).map_err(SignupEmailRequestError::InvalidEmail)?;
        let password =
            Password::new(&password).map_err(SignupEmailRequestError::InvalidPassword)?;

        let password_hash = password_hasher::hash_password(&password)?;

        Ok(Self {
            email,
            password_hash,
        })
    }
}

#[derive(Debug, Error)]
pub(in crate::auth) enum SignupEmailError {
    #[error("Email {0} already exists")]
    EmailAlreadyExists(String),
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpSignupEmailResponse {
    pub email: Email,
    pub email_verified: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl From<User> for HttpSignupEmailResponse {
    fn from(user: User) -> Self {
        HttpSignupEmailResponse {
            email: user.email().to_owned(),
            email_verified: user.email_verified(),
            created_at: user.created_at(),
            updated_at: user.updated_at(),
        }
    }
}

#[cfg(test)]
mod tests {
    use fake::{Fake, Faker};

    use super::*;

    #[test]
    fn test_valid_email_signup_request() {
        let email = Faker.fake::<Email>();
        let password = Faker.fake::<Password>();

        let result = SignupEmailRequest::new(email.to_string(), password.as_str().to_string());
        assert!(result.is_ok());
    }

    #[test]
    fn test_invalid_email_signup_request() {
        let invalid_email = "invalid-email".to_string();
        let password = Faker.fake::<Password>();
        let result = SignupEmailRequest::new(invalid_email, password.as_str().to_string());
        assert!(matches!(
            result,
            Err(SignupEmailRequestError::InvalidEmail(_))
        ));
    }

    #[test]
    fn test_invalid_password_signup_request() {
        let email = Faker.fake::<Email>();
        let invalid_password = "invalid-password".to_string();
        let result = SignupEmailRequest::new(email.to_string(), invalid_password);
        assert!(matches!(
            result,
            Err(SignupEmailRequestError::InvalidPassword(_))
        ));
    }
}
