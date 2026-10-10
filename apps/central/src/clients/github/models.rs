use serde::Deserialize;

/// Full documentation: https://docs.github.com/en/rest/users/users?apiVersion=2026-03-10#get-the-authenticated-user
#[derive(Debug, Deserialize, Clone)]
pub struct GithubApiUserResponse {
    pub id: u64,
    pub login: String,
}

/// Full documentation: https://docs.github.com/en/rest/users/emails?apiVersion=2026-03-10#list-email-addresses-for-the-authenticated-user
pub type GithubApiUserEmailsResponse = Vec<GithubApiUserEmailsResponseItem>;
#[derive(Debug, Deserialize, Clone)]
pub struct GithubApiUserEmailsResponseItem {
    pub email: String,
    pub primary: bool,
    pub verified: bool,
}
