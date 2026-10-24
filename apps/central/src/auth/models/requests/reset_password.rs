use serde::Deserialize;
use thiserror::Error;

#[derive(Deserialize)]
pub struct HttpResetPasswordBody {
    pub token: String,
    pub password: String,
}

#[derive(Debug, Error)]
pub enum ResetPasswordError {
    #[error("This password reset link is invalid or expired.")]
    InvalidToken,
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}
