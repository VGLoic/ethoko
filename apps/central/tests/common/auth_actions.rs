use ethoko_central::{
    auth::requests::login_email::LoginEmailBody, auth::requests::signup_email::SignupEmailBody,
    auth::users_response::LoginResponse, auth::users_response::UserResponse,
    newtypes::email::Email, newtypes::handle::Handle, newtypes::password::Password,
};
use fake::{Fake, Faker};

use crate::common::InstanceState;

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

        let signup_body = SignupEmailBody {
            email: email.to_string(),
            handle: handle.to_string(),
            password: password.as_str().to_owned(),
        };
        let user = self
            .reqwest_client
            .post(format!("{}/auth/signup/email", &self.server_url))
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
            .post(format!("{}/auth/login", &self.server_url))
            .json(&LoginEmailBody {
                email: email.to_string(),
                password: password.as_str().to_string(),
            })
            .send()
            .await
            .unwrap()
            .json::<LoginResponse>()
            .await
            .unwrap()
            .token
    }
}
