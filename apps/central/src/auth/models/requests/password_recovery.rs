use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Deserialize)]
pub struct HttpForgotPasswordBody {
    pub email: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpForgotPasswordResponse {
    pub message: &'static str,
    pub cooldown_seconds: u16,
}

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
