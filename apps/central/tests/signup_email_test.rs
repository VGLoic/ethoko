use axum::http::StatusCode;
use ethoko_central::{
    auth::requests::signup_email::{HttpSignupEmailBody, HttpSignupEmailResponse},
    newtypes::{email::Email, password::Password},
    router::UnprocessableEntityError,
};
mod common;
use common::{TestConfigBuilder, central_ui_bff_principal_headers, setup_instance};
use fake::{Fake, Faker};

#[tokio::test]
async fn test_signup_email() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let email = Faker.fake::<Email>();
    let password = Faker.fake::<Password>();

    let signup_body = HttpSignupEmailBody {
        email: email.to_string(),
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
    let body: serde_json::Value = response.json().await.unwrap();
    assert!(body.get("state").is_none());
    assert!(body.get("handle").is_none());
    assert_eq!(body.get("suggestedHandle"), Some(&serde_json::Value::Null));
    assert_eq!(
        body.get("handle_registration"),
        Some(&serde_json::Value::Null)
    );
    let response_body: HttpSignupEmailResponse = serde_json::from_value(body).unwrap();
    assert_eq!(response_body.email, email);
    assert!(!response_body.email_verified);
}

#[tokio::test]
async fn test_signup_email_uses_configured_bff_credential() {
    let mut config = TestConfigBuilder::build_default();
    config.central_ui_bff_shared_secret = "deployment-specific-bff-secret".into();
    let instance_state = setup_instance(&config).await.unwrap();
    let signup_body = HttpSignupEmailBody {
        email: Faker.fake::<Email>().to_string(),
        password: Faker.fake::<Password>().as_str().to_owned(),
    };

    let response = instance_state
        .reqwest_client
        .post(format!("{}/auth/signup/email", &instance_state.server_url))
        .headers(central_ui_bff_principal_headers())
        .json(&signup_body)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let response = instance_state
        .reqwest_client
        .post(format!("{}/auth/signup/email", &instance_state.server_url))
        .bearer_auth(&config.central_ui_bff_shared_secret)
        .json(&signup_body)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let response_body: HttpSignupEmailResponse = response.json().await.unwrap();
    assert_eq!(response_body.email.to_string(), signup_body.email);
}

#[tokio::test]
async fn test_signup_email_trigger_otp_email_sending() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let email = Faker.fake::<Email>();
    let password = Faker.fake::<Password>();

    let signup_body = HttpSignupEmailBody {
        email: email.to_string(),
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
        .json::<HttpSignupEmailResponse>()
        .await
        .unwrap();

    instance_state.job_worker.consume_jobs().await.unwrap();

    assert!(instance_state.email_service.has_sent_email_to(&email))
}

#[tokio::test]
async fn test_signup_email_422_invalid_email_format_422() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let response = instance_state
        .reqwest_client
        .post(format!("{}/auth/signup/email", &instance_state.server_url))
        .headers(central_ui_bff_principal_headers())
        .json(&serde_json::json!({ "email": "invalid-email", "password": "password123" }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = response.json::<UnprocessableEntityError>().await.unwrap();
    assert_eq!(error.code, "ETKAG01");
}

#[tokio::test]
async fn test_signup_email_with_existing_email_422() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let email = Faker.fake::<Email>();
    let password = Faker.fake::<Password>();

    let first_signup_body = HttpSignupEmailBody {
        email: email.to_string(),
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
async fn test_signup_email_401_without_bff_credential() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let email = Faker.fake::<Email>();
    let password = Faker.fake::<Password>();

    let signup_body = HttpSignupEmailBody {
        email: email.to_string(),
        password: password.as_str().to_owned(),
    };

    let response = instance_state
        .reqwest_client
        .post(format!("{}/auth/signup/email", &instance_state.server_url))
        .json(&signup_body)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
