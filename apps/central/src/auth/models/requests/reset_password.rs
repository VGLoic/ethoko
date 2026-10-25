use serde::Deserialize;
use thiserror::Error;

use crate::{
    auth::password_hasher,
    newtypes::{
        password::{Password, PasswordError},
        password_hash::PasswordHash,
    },
};

#[derive(Deserialize)]
pub struct HttpResetPasswordBody {
    pub token: String,
    pub password: String,
}

pub struct ResetPasswordRequest {
    pub token: String,
    pub password_hash: PasswordHash,
}

#[derive(Debug, Error)]
pub enum ResetPasswordRequestError {
    #[error("Invalid password")]
    InvalidPassword(PasswordError),
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}

impl ResetPasswordRequest {
    /// Creates a new `ResetPasswordRequest` after validating and hashing the password.
    ///
    /// # Errors
    /// `ResetPasswordRequestError::InvalidPassword` if the password format is invalid.
    /// `ResetPasswordRequestError::Unknown` if password hashing fails.
    pub fn new(token: String, password: String) -> Result<Self, ResetPasswordRequestError> {
        let password =
            Password::new(&password).map_err(ResetPasswordRequestError::InvalidPassword)?;
        let password_hash = password_hasher::hash_password(&password)?;

        Ok(Self {
            token,
            password_hash,
        })
    }
}

#[derive(Debug, Error)]
pub enum ResetPasswordError {
    #[error("This password reset link is invalid or expired.")]
    InvalidToken,
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}
