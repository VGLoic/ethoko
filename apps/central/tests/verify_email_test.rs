use std::time::Duration;

use axum::http::StatusCode;
use ethoko_central::{
    auth::requests::verify_email::HttpVerifyEmailBody, externalcom::email::EmailTemplate,
    router::UnprocessableEntityError,
};
mod common;
use common::{AuthActions, TestConfigBuilder, central_ui_bff_principal_headers, setup_instance};

#[tokio::test]
async fn test_verify_email_200_valid_otp() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let (user, _password) = instance_state.signup_user().await;

    let otp = instance_state
        .email_service
        .get_emails_sent_to(&user.email)
        .first()
        .map(|t| match t {
            EmailTemplate::EmailVerificationCode(payload) => payload.otp.show().to_string(),
        })
        .expect("Expected an OTP email to be sent");

    let verify_email_body = HttpVerifyEmailBody {
        email: user.email.to_string(),
        otp: otp.to_string(),
    };

    let response = instance_state
        .reqwest_client
        .post(format!("{}/auth/verify-email", &instance_state.server_url))
        .headers(central_ui_bff_principal_headers())
        .json(&verify_email_body)
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_verify_email_422_already_verified() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let (user, _password) = instance_state.signup_user().await;

    let otp = instance_state
        .email_service
        .get_emails_sent_to(&user.email)
        .first()
        .map(|t| match t {
            EmailTemplate::EmailVerificationCode(payload) => payload.otp.show().to_string(),
        })
        .expect("Expected an OTP email to be sent");

    let verify_email_body = HttpVerifyEmailBody {
        email: user.email.to_string(),
        otp: otp.to_string(),
    };

    // First verification attempt
    let response = instance_state
        .reqwest_client
        .post(format!("{}/auth/verify-email", &instance_state.server_url))
        .headers(central_ui_bff_principal_headers())
        .json(&verify_email_body)
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Second verification attempt with the same OTP
    let response = instance_state
        .reqwest_client
        .post(format!("{}/auth/verify-email", &instance_state.server_url))
        .headers(central_ui_bff_principal_headers())
        .json(&verify_email_body)
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = response.json::<UnprocessableEntityError>().await.unwrap();
    assert_eq!(error.code, "ETKAVE01");
}

#[tokio::test]
async fn test_verify_email_422_invalid_otp() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let (user, _password) = instance_state.signup_user().await;

    let verify_email_body = HttpVerifyEmailBody {
        email: user.email.to_string(),
        otp: "invalid-otp".to_string(),
    };

    let response = instance_state
        .reqwest_client
        .post(format!("{}/auth/verify-email", &instance_state.server_url))
        .headers(central_ui_bff_principal_headers())
        .json(&verify_email_body)
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = response.json::<UnprocessableEntityError>().await.unwrap();
    assert_eq!(error.code, "ETKAVE02");
}

#[tokio::test]
async fn test_verify_email_422_invalid_email() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let (user, _password) = instance_state.signup_user().await;

    let otp = instance_state
        .email_service
        .get_emails_sent_to(&user.email)
        .first()
        .map(|t| match t {
            EmailTemplate::EmailVerificationCode(payload) => payload.otp.show().to_string(),
        })
        .expect("Expected an OTP email to be sent");

    let verify_email_body = HttpVerifyEmailBody {
        email: "invalid-email".to_string(),
        otp: otp.to_string(),
    };

    let response = instance_state
        .reqwest_client
        .post(format!("{}/auth/verify-email", &instance_state.server_url))
        .headers(central_ui_bff_principal_headers())
        .json(&verify_email_body)
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = response.json::<UnprocessableEntityError>().await.unwrap();
    assert_eq!(error.code, "ETKAG01");
}

#[tokio::test]
async fn test_verify_email_422_expired_otp() {
    let instance_state = setup_instance(&TestConfigBuilder::new().with_otp_ttl(3).build())
        .await
        .unwrap();

    let (user, _password) = instance_state.signup_user().await;

    let otp = instance_state
        .email_service
        .get_emails_sent_to(&user.email)
        .first()
        .map(|t| match t {
            EmailTemplate::EmailVerificationCode(payload) => payload.otp.show().to_string(),
        })
        .expect("Expected an OTP email to be sent");

    // Simulate OTP expiration by advancing the time in the email service
    tokio::time::sleep(Duration::from_secs(3)).await; // Wait for OTP to expire (3 seconds)

    let verify_email_body = HttpVerifyEmailBody {
        email: user.email.to_string(),
        otp: otp.to_string(),
    };

    let response = instance_state
        .reqwest_client
        .post(format!("{}/auth/verify-email", &instance_state.server_url))
        .headers(central_ui_bff_principal_headers())
        .json(&verify_email_body)
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = response.json::<UnprocessableEntityError>().await.unwrap();
    assert_eq!(error.code, "ETKAVE03");
}

#[tokio::test]
async fn test_verify_email_401_without_bff_credential() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let response = instance_state
        .reqwest_client
        .post(format!("{}/auth/verify-email", &instance_state.server_url))
        .json(&serde_json::json!({ "email": "user@example.com", "otp": "123456" }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
