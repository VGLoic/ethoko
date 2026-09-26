use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::newtypes::{
    email::{Email, EmailError},
    password::{Password, PasswordError},
};

pub struct LoginEmailRequest {
    pub email: Email,
    pub password: Password,
}

#[derive(Debug, Error)]
pub enum LoginEmailRequestError {
    #[error("Invalid email")]
    InvalidEmail(EmailError),
    #[error("Invalid password")]
    InvalidPassword(PasswordError),
}

impl LoginEmailRequest {
    pub fn new(email: String, password: String) -> Result<Self, LoginEmailRequestError> {
        let email = Email::new(&email).map_err(LoginEmailRequestError::InvalidEmail)?;
        let password = Password::new(&password).map_err(LoginEmailRequestError::InvalidPassword)?;
        Ok(Self { email, password })
    }
}

#[derive(Debug, Error)]
pub enum LoginEmailError {
    #[error("User not found")]
    UserNotFound,
    #[error("Invalid login credentials")]
    InvalidCredentials,
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpLoginEmailBody {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpLoginEmailResponse {
    pub token: String,
}
