use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::newtypes::email::{Email, EmailError};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResendVerificationOtpBody {
    pub email: String,
}

pub struct ResendVerificationOtpRequest {
    pub email: Email,
}

impl ResendVerificationOtpRequest {
    pub fn new(email: String) -> Result<Self, ResendVerificationOtpRequestError> {
        let email = Email::new(&email)?;

        Ok(Self { email })
    }
}

#[derive(Error, Debug)]
pub enum ResendVerificationOtpRequestError {
    #[error(transparent)]
    InvalidEmail(#[from] EmailError),
}

#[derive(Debug, Error)]
pub enum ResendVerificationOtpError {
    #[error("User not found")]
    UserNotFound,
    #[error("User email is already verified")]
    UserAlreadyVerified,
    #[error("Cooldown period has not elapsed yet for requesting a new verification code")]
    CooldownNotElapsed,
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}
