use ethoko_central::{
    auth::requests::login_email::{HttpLoginEmailBody, HttpLoginEmailResponse},
    auth::requests::resend_verification_otp::HttpResendVerificationOtpBody,
    auth::requests::signup_email::{HttpSignupEmailBody, HttpSignupEmailResponse},
    auth::requests::verify_email::HttpVerifyEmailBody,
    externalcom::email::EmailTemplate,
    newtypes::email::Email,
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
    /// The email and password are generated automatically.
    async fn signup_user(&self) -> (HttpSignupEmailResponse, Password);

    /// Submits an email verification attempt, preserving the HTTP response.
    /// Panics if the HTTP request fails.
    async fn verify_email(&self, email: &Email, otp: &str) -> reqwest::Response;

    /// Requests another verification code, preserving the HTTP response.
    /// Panics if the HTTP request fails.
    async fn resend_verification_otp(&self, email: &Email) -> reqwest::Response;

    /// Returns the codes in captured verification emails for this recipient.
    /// Panics if the captured email lock is poisoned.
    fn verification_codes(&self, email: &Email) -> Vec<String>;

    /// Logs in a user with the given email and password, returning the authentication token.
    async fn login_user(&self, email: &Email, password: &Password) -> String;
}

impl AuthActions for InstanceState {
    async fn signup_user(&self) -> (HttpSignupEmailResponse, Password) {
        let email = Faker.fake::<Email>();
        let password = Faker.fake::<Password>();

        let signup_body = HttpSignupEmailBody {
            email: email.to_string(),
            password: password.as_str().to_owned(),
        };
        let response = self
            .reqwest_client
            .post(format!("{}/auth/signup/email", &self.server_url))
            .bearer_auth(CENTRAL_UI_BFF_SHARED_SECRET)
            .json(&signup_body)
            .send()
            .await
            .unwrap();
        let status = response.status();
        let body = response.text().await.unwrap();
        assert_eq!(
            status,
            reqwest::StatusCode::CREATED,
            "signup failed: {body}"
        );
        let user = serde_json::from_str::<HttpSignupEmailResponse>(&body).unwrap();

        self.job_worker.consume_jobs().await.unwrap();

        (user, password)
    }

    async fn verify_email(&self, email: &Email, otp: &str) -> reqwest::Response {
        self.reqwest_client
            .post(format!("{}/auth/verify-email", self.server_url))
            .headers(central_ui_bff_principal_headers())
            .json(&HttpVerifyEmailBody {
                email: email.to_string(),
                otp: otp.to_owned(),
            })
            .send()
            .await
            .unwrap()
    }

    async fn resend_verification_otp(&self, email: &Email) -> reqwest::Response {
        self.reqwest_client
            .post(format!("{}/auth/resend-verification-otp", self.server_url))
            .headers(central_ui_bff_principal_headers())
            .json(&HttpResendVerificationOtpBody {
                email: email.to_string(),
            })
            .send()
            .await
            .unwrap()
    }

    fn verification_codes(&self, email: &Email) -> Vec<String> {
        self.email_service
            .get_emails_sent_to(email)
            .iter()
            .map(|template| match template {
                EmailTemplate::EmailVerificationCode(payload) => payload.otp.show().to_owned(),
            })
            .collect()
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
