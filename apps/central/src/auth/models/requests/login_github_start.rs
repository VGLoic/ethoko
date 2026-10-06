use oauth2::CsrfToken;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum LoginGithubStartError {
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}

pub struct LoginGithubStart {
    pub auth_url: String,
    pub csrf_token: CsrfToken,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpLoginGithubStartResponse {
    pub auth_url: String,
    pub csrf_token: String,
}
