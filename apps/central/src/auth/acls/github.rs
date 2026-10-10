use crate::{
    auth::{
        models::github_acl::GithubUser, requests::login_github_callback::LoginGithubCallbackError,
    },
    clients::github::GithubClient,
    newtypes::email::Email,
};

#[async_trait::async_trait]
pub trait AuthGithubPort: Send + Sync + 'static {
    /// Get the authenticated user's GitHub profile information and primary email.
    ///
    /// # Errors
    /// * `LoginGithubCallbackError::Unknown` if any error occurs in the process
    async fn get_user(&self, access_token: &str) -> Result<GithubUser, LoginGithubCallbackError>;
}

pub struct AuthGithubAdapter<G: GithubClient> {
    github_client: G,
}

impl<G: GithubClient> AuthGithubAdapter<G> {
    pub fn new(github_client: G) -> Self {
        Self { github_client }
    }
}

#[async_trait::async_trait]
impl<G: GithubClient> AuthGithubPort for AuthGithubAdapter<G> {
    async fn get_user(&self, access_token: &str) -> Result<GithubUser, LoginGithubCallbackError> {
        let authenticated_user = self
            .github_client
            .get_user(access_token)
            .await
            .map_err(|e| e.context("failed to retrieve user"))?;

        let emails = self
            .github_client
            .get_user_emails(access_token)
            .await
            .map_err(|e| e.context("failed to retrieve user emails"))?;

        let primary_email_item = match emails.into_iter().find(|email| email.primary) {
            Some(email) => email,
            None => {
                return Err(LoginGithubCallbackError::Unknown(anyhow::anyhow!(
                    "github user does not have a primary email"
                )));
            }
        };

        let primary_email = Email::new(&primary_email_item.email).map_err(|e| {
            anyhow::Error::new(e).context("failed to map primary email to email newtype")
        })?;

        Ok(GithubUser {
            id: authenticated_user.id,
            username: authenticated_user.login,
            primary_email,
            email_verified: primary_email_item.verified,
        })
    }
}
