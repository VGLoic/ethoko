use axum::http::StatusCode;
use ethoko_central::{
    auth::{requests::signup_email::SignupEmailBody, users_response},
    newtypes::{email::Email, handle::Handle, password::Password},
};
mod common;
use common::{TestConfigBuilder, setup_instance};
use fake::{Fake, Faker};

#[tokio::test]
async fn test_signup() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let email = Faker.fake::<Email>();
    let handle = Faker.fake::<Handle>();
    let password = Faker.fake::<Password>();

    let signup_body = SignupEmailBody {
        email: email.to_string(),
        handle: handle.to_string(),
        password: password.as_str().to_owned(),
    };
    let response = instance_state
        .reqwest_client
        .post(format!("{}/auth/signup/email", &instance_state.server_url))
        .json(&signup_body)
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let response_body: users_response::UserResponse = response.json().await.unwrap();
    assert_eq!(response_body.email, email);
    assert_eq!(response_body.handle, handle);
}

#[tokio::test]
async fn test_signup_trigger_otp_email_sending() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let email = Faker.fake::<Email>();
    let handle = Faker.fake::<Handle>();
    let password = Faker.fake::<Password>();

    let signup_body = SignupEmailBody {
        email: email.to_string(),
        handle: handle.to_string(),
        password: password.as_str().to_owned(),
    };
    let _ = instance_state
        .reqwest_client
        .post(format!("{}/auth/signup/email", &instance_state.server_url))
        .json(&signup_body)
        .send()
        .await
        .unwrap()
        .json::<users_response::UserResponse>()
        .await
        .unwrap();

    instance_state.job_worker.consume_jobs().await.unwrap();

    assert!(instance_state.email_service.has_sent_email_to(&email))
}

#[tokio::test]
async fn test_signup_invalid_email() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let response = instance_state.reqwest_client.post(format!("{}/auth/signup/email", &instance_state.server_url))
        .json(&serde_json::json!({ "email": "invalid-email", "handle": "testuser", "password": "password123" }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_signup_with_existing_email_fails() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let email = Faker.fake::<Email>();
    let handle = Faker.fake::<Handle>();
    let password = Faker.fake::<Password>();

    let first_signup_body = SignupEmailBody {
        email: email.to_string(),
        handle: handle.to_string(),
        password: password.as_str().to_owned(),
    };
    instance_state
        .reqwest_client
        .post(format!("{}/auth/signup/email", &instance_state.server_url))
        .json(&first_signup_body)
        .send()
        .await
        .unwrap();
    let second_signup_body = SignupEmailBody {
        email: email.to_string(),
        handle: Faker.fake::<Handle>().to_string(),
        password: Faker.fake::<Password>().as_str().to_owned(),
    };

    let response = instance_state
        .reqwest_client
        .post(format!("{}/auth/signup/email", &instance_state.server_url))
        .json(&second_signup_body)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn test_signup_with_existing_handle_fails() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let email = Faker.fake::<Email>();
    let handle = Faker.fake::<Handle>();
    let password = Faker.fake::<Password>();

    let first_signup_body = SignupEmailBody {
        email: email.to_string(),
        handle: handle.to_string(),
        password: password.as_str().to_owned(),
    };
    instance_state
        .reqwest_client
        .post(format!("{}/auth/signup/email", &instance_state.server_url))
        .json(&first_signup_body)
        .send()
        .await
        .unwrap();
    let second_signup_body = SignupEmailBody {
        email: Faker.fake::<Email>().to_string(),
        handle: handle.to_string(),
        password: Faker.fake::<Password>().as_str().to_owned(),
    };

    let response = instance_state
        .reqwest_client
        .post(format!("{}/auth/signup/email", &instance_state.server_url))
        .json(&second_signup_body)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
}
