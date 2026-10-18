use serde::Deserialize;
use thiserror::Error;

#[derive(Deserialize)]
pub struct HttpForgotPasswordBody {
    pub email: String,
}

#[derive(Deserialize)]
pub struct HttpResetPasswordBody {
    pub token: String,
    pub password: String,
}

#[derive(Debug, Error)]
pub enum ResetPasswordError {
    #[error("Invalid or expired reset link")]
    InvalidToken,
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}
