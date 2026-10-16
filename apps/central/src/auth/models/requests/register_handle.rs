use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::newtypes::handle::{Handle, HandleError};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRegisterHandleBody {
    pub handle: String,
}

pub struct RegisterHandleRequest {
    pub handle: Handle,
}

impl RegisterHandleRequest {
    pub fn new(handle: String) -> Result<Self, RegisterHandleRequestError> {
        Ok(Self {
            handle: Handle::new(&handle).map_err(RegisterHandleRequestError::InvalidHandle)?,
        })
    }
}

#[derive(Debug, Error)]
pub enum RegisterHandleRequestError {
    #[error("Invalid handle")]
    InvalidHandle(HandleError),
}

#[derive(Debug, Error)]
pub enum RegisterHandleError {
    #[error("Handle {0} already exists")]
    HandleAlreadyExists(String),
    #[error("User already registered")]
    AlreadyRegistered,
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}
