use axum::http::StatusCode;
use ethoko_central::{
    auth::{http_responses::UserResponse, requests::signup_email::HttpSignupEmailBody},
    newtypes::{email::Email, handle::Handle, password::Password},
    router::UnprocessableEntityError,
};
mod common;
use common::{TestConfigBuilder, central_ui_bff_principal_headers, setup_instance};
use fake::{Fake, Faker};

#[tokio::test]
async fn test_signup() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let email = Faker.fake::<Email>();
    let handle = Faker.fake::<Handle>();
    let password = Faker.fake::<Password>();

    let signup_body = HttpSignupEmailBody {
        email: email.to_string(),
        handle: handle.to_string(),
        password: password.as_str().to_owned(),
    };
    let response = instance_state
        .reqwest_client
        .post(format!("{}/auth/signup/email", &instance_state.server_url))
        .headers(central_ui_bff_principal_headers())
        .json(&signup_body)
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let response_body: UserResponse = response.json().await.unwrap();
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

    let signup_body = HttpSignupEmailBody {
        email: email.to_string(),
        handle: handle.to_string(),
        password: password.as_str().to_owned(),
    };
    let _ = instance_state
        .reqwest_client
        .post(format!("{}/auth/signup/email", &instance_state.server_url))
        .headers(central_ui_bff_principal_headers())
        .json(&signup_body)
        .send()
        .await
        .unwrap()
        .json::<UserResponse>()
        .await
        .unwrap();

    instance_state.job_worker.consume_jobs().await.unwrap();

    assert!(instance_state.email_service.has_sent_email_to(&email))
}

#[tokio::test]
async fn test_signup_422_invalid_email_format_422() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let response = instance_state.reqwest_client.post(format!("{}/auth/signup/email", &instance_state.server_url))
        .headers(central_ui_bff_principal_headers())
        .json(&serde_json::json!({ "email": "invalid-email", "handle": "testuser", "password": "password123" }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = response.json::<UnprocessableEntityError>().await.unwrap();
    assert_eq!(error.code, "ETKAG01");
}

#[tokio::test]
async fn test_signup_with_existing_email_422() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let email = Faker.fake::<Email>();
    let handle = Faker.fake::<Handle>();
    let password = Faker.fake::<Password>();

    let first_signup_body = HttpSignupEmailBody {
        email: email.to_string(),
        handle: handle.to_string(),
        password: password.as_str().to_owned(),
    };
    instance_state
        .reqwest_client
        .post(format!("{}/auth/signup/email", &instance_state.server_url))
        .headers(central_ui_bff_principal_headers())
        .json(&first_signup_body)
        .send()
        .await
        .unwrap();
    let second_signup_body = HttpSignupEmailBody {
        email: email.to_string(),
        handle: Faker.fake::<Handle>().to_string(),
        password: Faker.fake::<Password>().as_str().to_owned(),
    };

    let response = instance_state
        .reqwest_client
        .post(format!("{}/auth/signup/email", &instance_state.server_url))
        .headers(central_ui_bff_principal_headers())
        .json(&second_signup_body)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = response.json::<UnprocessableEntityError>().await.unwrap();
    assert_eq!(error.code, "ETKAS01");
}

#[tokio::test]
async fn test_signup_with_existing_handle_422() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let email = Faker.fake::<Email>();
    let handle = Faker.fake::<Handle>();
    let password = Faker.fake::<Password>();

    let first_signup_body = HttpSignupEmailBody {
        email: email.to_string(),
        handle: handle.to_string(),
        password: password.as_str().to_owned(),
    };
    instance_state
        .reqwest_client
        .post(format!("{}/auth/signup/email", &instance_state.server_url))
        .headers(central_ui_bff_principal_headers())
        .json(&first_signup_body)
        .send()
        .await
        .unwrap();
    let second_signup_body = HttpSignupEmailBody {
        email: Faker.fake::<Email>().to_string(),
        handle: handle.to_string(),
        password: Faker.fake::<Password>().as_str().to_owned(),
    };

    let response = instance_state
        .reqwest_client
        .post(format!("{}/auth/signup/email", &instance_state.server_url))
        .headers(central_ui_bff_principal_headers())
        .json(&second_signup_body)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = response.json::<UnprocessableEntityError>().await.unwrap();
    assert_eq!(error.code, "ETKAS02");
}
