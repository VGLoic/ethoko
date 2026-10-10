use crate::clients::github::models::{GithubApiUserEmailsResponse, GithubApiUserResponse};

const GITHUB_API_VERSION_HEADER: &str = "X-GitHub-Api-Version";
const GITHUB_API_VERSION_HEADER_VALUE: &str = "2026-03-10";
const GITHUB_API_ACCEPT_HEADER: &str = "Accept";
const GITHUB_API_ACCEPT_HEADER_VALUE: &str = "application/vnd.github+json";

#[async_trait::async_trait]
pub trait GithubClient: Send + Sync + 'static {
    /// Get the authenticated user's GitHub profile information.
    /// https://docs.github.com/en/rest/users/users?apiVersion=2026-03-10#get-the-authenticated-user
    async fn get_user(&self, access_token: &str) -> Result<GithubApiUserResponse, anyhow::Error>;

    /// Get the authenticated user's GitHub email addresses.
    /// https://docs.github.com/en/rest/users/emails?apiVersion=2026-03-10#list-email-addresses-for-the-authenticated-user
    async fn get_user_emails(
        &self,
        access_token: &str,
    ) -> Result<GithubApiUserEmailsResponse, anyhow::Error>;
}

pub struct GithubClientImpl {
    base_url: String,
    http_client: reqwest::Client,
}

impl GithubClientImpl {
    pub fn new(github_api_url: &str) -> Self {
        Self {
            base_url: github_api_url.to_string(),
            http_client: reqwest::Client::new(),
        }
    }

    fn build_headers(&self) -> reqwest::header::HeaderMap {
        let mut headers_map = reqwest::header::HeaderMap::new();
        headers_map.insert(
            GITHUB_API_VERSION_HEADER,
            GITHUB_API_VERSION_HEADER_VALUE.parse().unwrap(),
        );
        headers_map.insert(
            GITHUB_API_ACCEPT_HEADER,
            GITHUB_API_ACCEPT_HEADER_VALUE.parse().unwrap(),
        );
        headers_map
    }
}

#[async_trait::async_trait]
impl GithubClient for GithubClientImpl {
    async fn get_user(&self, access_token: &str) -> Result<GithubApiUserResponse, anyhow::Error> {
        self.http_client
            .get(format!("{}/user", self.base_url))
            .headers(self.build_headers())
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| anyhow::Error::new(e).context("Failed to send request to GitHub"))?
            .json::<GithubApiUserResponse>()
            .await
            .map_err(|e| anyhow::Error::new(e).context("Failed to parse GitHub API response"))
    }

    async fn get_user_emails(
        &self,
        access_token: &str,
    ) -> Result<GithubApiUserEmailsResponse, anyhow::Error> {
        self.http_client
            .get(format!("{}/user/emails", self.base_url))
            .headers(self.build_headers())
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| anyhow::Error::new(e).context("Failed to send request to GitHub"))?
            .json::<GithubApiUserEmailsResponse>()
            .await
            .map_err(|e| anyhow::Error::new(e).context("Failed to parse GitHub API response"))
    }
}
