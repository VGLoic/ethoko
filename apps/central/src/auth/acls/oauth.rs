use oauth2::{CsrfToken, EndpointNotSet, EndpointSet, TokenResponse, basic::BasicClient};

use crate::{auth::models::oauth_acl::AuthorizationUrl, config::OauthClientConfig};

#[async_trait::async_trait]
pub trait AuthOauthClientPort: Send + Sync + 'static {
    /// Generates an authorization URL for the OAuth client along with the associated state.
    ///
    /// # Errors
    /// * `anyhow::Error` if the authorization URL could not be generated.
    async fn generate_authorization_url(
        &self,
        scopes: Vec<&str>,
    ) -> Result<AuthorizationUrl, anyhow::Error>;

    /// Exchanges the authorization code for an access token.
    ///
    /// # Errors
    /// * `anyhow::Error` if the access token could not be obtained.
    async fn exchange_code_for_token(&self, code: &str) -> Result<String, anyhow::Error>;
}

pub struct AuthOauthClientAdapter {
    http_client: oauth2::reqwest::Client,
    oauth_client: oauth2::basic::BasicClient<
        EndpointSet,
        EndpointNotSet,
        EndpointNotSet,
        EndpointNotSet,
        EndpointSet,
    >,
}

impl AuthOauthClientAdapter {
    pub fn new(oauth_client_config: OauthClientConfig) -> Self {
        let http_client = oauth2::reqwest::Client::builder()
            // Following redirects opens the client up to SSRF vulnerabilities.
            .redirect(oauth2::reqwest::redirect::Policy::none())
            .build()
            .expect("Failed to build HTTP client");
        let oauth_client = BasicClient::new(oauth_client_config.client_id)
            .set_auth_uri(oauth_client_config.auth_url)
            .set_token_uri(oauth_client_config.auth_token_url)
            .set_redirect_uri(oauth_client_config.callback_url);

        Self {
            http_client,
            oauth_client,
        }
    }
}

#[async_trait::async_trait]
impl AuthOauthClientPort for AuthOauthClientAdapter {
    async fn generate_authorization_url(
        &self,
        scopes: Vec<&str>,
    ) -> Result<AuthorizationUrl, anyhow::Error> {
        let (auth_url, state) = self
            .oauth_client
            .authorize_url(CsrfToken::new_random)
            .add_scopes(
                scopes
                    .into_iter()
                    .map(|s| oauth2::Scope::new(s.to_string()))
                    .collect::<Vec<_>>(),
            )
            .url();
        Ok(AuthorizationUrl {
            url: auth_url.to_string(),
            state: state.into(),
        })
    }

    async fn exchange_code_for_token(&self, code: &str) -> Result<String, anyhow::Error> {
        let exchange_response = self
            .oauth_client
            .exchange_code(oauth2::AuthorizationCode::new(code.to_string()))
            .request_async(&self.http_client)
            .await
            .map_err(|e| anyhow::Error::new(e).context("Failed to request access token"))?;

        Ok(exchange_response.access_token().secret().to_string())
    }
}
