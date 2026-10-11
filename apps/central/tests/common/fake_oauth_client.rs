use std::sync::{Arc, Mutex};

use ethoko_central::auth::{AuthOauthClientPort, oauth_acl};
use fake::Fake;

#[derive(Clone)]
pub struct FakeOauthClient {
    code: Arc<Mutex<Option<String>>>,
}

impl Default for FakeOauthClient {
    fn default() -> Self {
        Self {
            code: Arc::new(Mutex::new(None)),
        }
    }
}

impl FakeOauthClient {
    pub fn code(&self) -> Option<String> {
        self.code.lock().unwrap().clone()
    }
}

#[async_trait::async_trait]
impl AuthOauthClientPort for FakeOauthClient {
    async fn generate_authorization_url(
        &self,
        _scopes: Vec<&str>,
    ) -> Result<oauth_acl::AuthorizationUrl, anyhow::Error> {
        let state = (10..20).fake::<String>();
        *self.code.lock().unwrap() = Some(state.clone());
        Ok(oauth_acl::AuthorizationUrl {
            url: "http://localhost:5173/oauth/authorize".into(),
            state: oauth_acl::OauthState::new(&state),
        })
    }

    async fn exchange_code_for_token(&self, code: &str) -> Result<String, anyhow::Error> {
        let mut stored_code = self.code.lock().unwrap();
        if stored_code.as_deref() != Some(code) {
            return Err(anyhow::anyhow!("Invalid code"));
        }
        *stored_code = None;

        Ok((10..20).fake::<String>())
    }
}
