use ethoko_central::clients::github::{
    GithubClient,
    models::{GithubApiUserEmailsResponse, GithubApiUserResponse},
};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone)]
pub struct FakeGithubClient {
    next_user_response: Arc<Mutex<Option<Result<GithubApiUserResponse, anyhow::Error>>>>,
    next_user_emails_response:
        Arc<Mutex<Option<Result<GithubApiUserEmailsResponse, anyhow::Error>>>>,
}

impl Default for FakeGithubClient {
    fn default() -> Self {
        Self {
            next_user_response: Arc::new(Mutex::new(None)),
            next_user_emails_response: Arc::new(Mutex::new(None)),
        }
    }
}

impl FakeGithubClient {
    pub fn set_next_user(&self, user_response: GithubApiUserResponse) {
        *self.next_user_response.lock().unwrap() = Some(Ok(user_response));
    }
    pub fn set_next_user_error(&self, error: anyhow::Error) {
        *self.next_user_response.lock().unwrap() = Some(Err(error));
    }

    pub fn set_next_user_emails(&self, response: GithubApiUserEmailsResponse) {
        *self.next_user_emails_response.lock().unwrap() = Some(Ok(response));
    }

    pub fn set_next_user_emails_error(&self, error: anyhow::Error) {
        *self.next_user_emails_response.lock().unwrap() = Some(Err(error));
    }
}

#[async_trait::async_trait]
impl GithubClient for FakeGithubClient {
    async fn get_user(&self, _access_token: &str) -> Result<GithubApiUserResponse, anyhow::Error> {
        self.next_user_response
            .lock()
            .unwrap()
            .take()
            .ok_or(anyhow::anyhow!("no response available"))?
    }

    async fn get_user_emails(
        &self,
        _access_token: &str,
    ) -> Result<GithubApiUserEmailsResponse, anyhow::Error> {
        self.next_user_emails_response
            .lock()
            .unwrap()
            .take()
            .ok_or(anyhow::anyhow!("no response available"))?
    }
}
