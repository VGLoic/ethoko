use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Deserialize, Serialize)]
pub struct HttpLoginGithubCallbackBody {
    pub code: String,
    pub state: String,
}

pub(in crate::auth) struct LoginGithubCallbackRequest {
    pub code: String,
    pub state: String,
}

impl LoginGithubCallbackRequest {
    pub fn new(code: String, state: String) -> Self {
        Self { code, state }
    }
}

#[derive(Debug, Error)]
pub(in crate::auth) enum LoginGithubCallbackError {
    #[error("Primary email is already associated to an account")]
    PrimaryEmailCollision,
    #[error("Oauth transaction has not been found")]
    OauthTransactionNotFound,
    #[error("Oauth transaction has expired")]
    OauthTransactionExpired,
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}

#[derive(Debug, Deserialize, Serialize)]
pub struct HttpLoginGithubCallbackResponse {
    pub token: String,
}
