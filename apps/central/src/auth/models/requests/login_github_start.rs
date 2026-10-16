use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::auth::models::oauth_acl::OauthState;

#[derive(Debug, Error)]
pub(in crate::auth) enum LoginGithubStartError {
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}

pub(in crate::auth) struct LoginGithubStart {
    pub auth_url: String,
    pub state: OauthState,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpLoginGithubStartResponse {
    pub auth_url: String,
    pub state: String,
}
