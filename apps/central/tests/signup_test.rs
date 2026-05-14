use axum::http::StatusCode;
use ethoko_central::{
    newtypes::{email::Email, handle::Handle},
    users::auth_router::SignupEmailBody,
};
mod common;
use common::{default_test_config, setup_instance};
use fake::{Fake, Faker};

#[tokio::test]
async fn test_signup() {
    let instance_state = setup_instance(&default_test_config()).await.unwrap();

    let email = Faker.fake::<Email>();
    let handle = Faker.fake::<Handle>();
    let password = "password123".to_owned();

    let signup_body = SignupEmailBody {
        email: email.to_string(),
        handle: handle.to_string(),
        password: password,
    };
    let response = instance_state
        .reqwest_client
        .post(format!("{}/auth/signup/email", &instance_state.server_url))
        .json(&signup_body)
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED)
    // REMIMD ME: complete with checking the response body for the created user details
}

#[tokio::test]
async fn test_signup_invalid_email() {
    let instance_state = setup_instance(&default_test_config()).await.unwrap();

    let response = instance_state.reqwest_client.post(format!("{}/auth/signup/email", &instance_state.server_url))
        .json(&serde_json::json!({ "email": "invalid-email", "handle": "testuser", "password": "password123" }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_successive_signup() {
    let instance_state = setup_instance(&default_test_config()).await.unwrap();

    let email = Faker.fake::<Email>();
    let handle = Faker.fake::<Handle>();
    let password = "password123".to_owned();

    let signup_body = SignupEmailBody {
        email: email.to_string(),
        handle: handle.to_string(),
        password: password,
    };
    instance_state
        .reqwest_client
        .post(format!("{}/auth/signup/email", &instance_state.server_url))
        .json(&signup_body)
        .send()
        .await
        .unwrap();

    let response = instance_state
        .reqwest_client
        .post(format!("{}/auth/signup/email", &instance_state.server_url))
        .json(&signup_body)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
}
