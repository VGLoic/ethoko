use ethoko_central::{
    auth::http_responses::UserResponse,
    auth::requests::login_email::{HttpLoginEmailBody, HttpLoginEmailResponse},
    auth::requests::signup_email::HttpSignupEmailBody,
    newtypes::email::Email,
    newtypes::handle::Handle,
    newtypes::password::Password,
};
use fake::{Fake, Faker};
use reqwest::header::{AUTHORIZATION, HeaderMap, HeaderValue};

use crate::common::InstanceState;

const CENTRAL_UI_BFF_SHARED_SECRET: &str = "test-central-ui-bff-shared-secret";
const USER_AUTHORIZATION_HEADER_NAME: &str = "X-Ethoko-User-Authorization";

#[allow(dead_code)]
pub trait AuthActions {
    /// Signs up a new user and returns the user response along with the password.
    /// The email, handle and password are generated automatically.
    async fn signup_user(&self) -> (UserResponse, Password);

    /// Logs in a user with the given email and password, returning the authentication token.
    async fn login_user(&self, email: &Email, password: &Password) -> String;
}

impl AuthActions for InstanceState {
    async fn signup_user(&self) -> (UserResponse, Password) {
        let email = Faker.fake::<Email>();
        let handle = Faker.fake::<Handle>();
        let password = Faker.fake::<Password>();

        let signup_body = HttpSignupEmailBody {
            email: email.to_string(),
            handle: handle.to_string(),
            password: password.as_str().to_owned(),
        };
        let user = self
            .reqwest_client
            .post(format!("{}/auth/signup/email", &self.server_url))
            .bearer_auth(CENTRAL_UI_BFF_SHARED_SECRET)
            .json(&signup_body)
            .send()
            .await
            .unwrap()
            .json::<UserResponse>()
            .await
            .unwrap();

        self.job_worker.consume_jobs().await.unwrap();

        (user, password)
    }

    async fn login_user(&self, email: &Email, password: &Password) -> String {
        self.reqwest_client
            .post(format!("{}/auth/login/email", &self.server_url))
            .bearer_auth(CENTRAL_UI_BFF_SHARED_SECRET)
            .json(&HttpLoginEmailBody {
                email: email.to_string(),
                password: password.as_str().to_string(),
            })
            .send()
            .await
            .unwrap()
            .json::<HttpLoginEmailResponse>()
            .await
            .unwrap()
            .token
    }
}

#[allow(dead_code)]
pub fn central_ui_bff_principal_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {CENTRAL_UI_BFF_SHARED_SECRET}"))
            .expect("Central UI BFF shared secret should be a valid bearer header value"),
    );
    headers
}

#[allow(dead_code)]
pub fn central_ui_bff_with_user_principal_headers(token: &str) -> HeaderMap {
    let mut headers = central_ui_bff_principal_headers();
    headers.insert(
        USER_AUTHORIZATION_HEADER_NAME,
        HeaderValue::from_str(&format!("Bearer {token}"))
            .expect("User session token should be a valid bearer header value"),
    );
    headers
}
