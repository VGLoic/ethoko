use std::time::Duration;

use axum::http::StatusCode;
use ethoko_central::{
    auth::requests::verify_email::VerifyEmailBody, externalcom::email::EmailTemplate,
};
mod common;
use common::{TestConfigBuilder, setup_instance};

#[tokio::test]
async fn test_resend_verification_email_200() {
    let instance_state = setup_instance(&TestConfigBuilder::new().with_otp_cooldown(3).build())
        .await
        .unwrap();

    let (user, _password) = instance_state.signup_user().await;

    // Wait for 4 seconds to ensure the cooldown period has passed
    tokio::time::sleep(Duration::from_secs(4)).await;

    let resend_response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/resend-verification-otp",
            &instance_state.server_url
        ))
        .json(&serde_json::json!({ "email": user.email.to_string() }))
        .send()
        .await
        .unwrap();

    // Process the second OTP email sending
    instance_state.job_worker.consume_jobs().await.unwrap();

    let emails_sent = instance_state.email_service.get_emails_sent_to(&user.email);
    let second_otp = emails_sent
        .get(1)
        .map(|t| match t {
            EmailTemplate::EmailVerificationCode(payload) => payload.otp.show().to_string(),
        })
        .expect("Expected a second OTP email to be sent");

    let verify_email_response = instance_state
        .reqwest_client
        .post(format!("{}/auth/verify-email", &instance_state.server_url))
        .json(&VerifyEmailBody {
            email: user.email.to_string(),
            otp: second_otp,
        })
        .send()
        .await
        .unwrap();

    assert_eq!(resend_response.status(), StatusCode::OK);
    assert_eq!(emails_sent.len(), 2);
    assert_eq!(verify_email_response.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_resend_verification_email_invalid_email_400() {
    let instance_state = setup_instance(&TestConfigBuilder::new().build())
        .await
        .unwrap();

    let resend_response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/resend-verification-otp",
            &instance_state.server_url
        ))
        .json(&serde_json::json!({ "email": "invalid-email-format" }))
        .send()
        .await
        .unwrap();

    assert_eq!(resend_response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_resend_verification_email_user_not_found_404() {
    let instance_state = setup_instance(&TestConfigBuilder::new().build())
        .await
        .unwrap();

    let resend_response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/resend-verification-otp",
            &instance_state.server_url
        ))
        .json(&serde_json::json!({ "email": "nonexistent@example.com" }))
        .send()
        .await
        .unwrap();

    assert_eq!(resend_response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_resend_verification_email_user_already_verified_400() {
    let instance_state = setup_instance(&TestConfigBuilder::new().build())
        .await
        .unwrap();

    let (user, _password) = instance_state.signup_user().await;

    let emails_sent = instance_state.email_service.get_emails_sent_to(&user.email);
    let first_otp = emails_sent
        .first()
        .map(|t| match t {
            EmailTemplate::EmailVerificationCode(payload) => payload.otp.show().to_string(),
        })
        .expect("Expected a first OTP email to be sent");

    let verify_email_response = instance_state
        .reqwest_client
        .post(format!("{}/auth/verify-email", &instance_state.server_url))
        .json(&VerifyEmailBody {
            email: user.email.to_string(),
            otp: first_otp,
        })
        .send()
        .await
        .unwrap();

    assert_eq!(verify_email_response.status(), StatusCode::OK);

    let resend_response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/resend-verification-otp",
            &instance_state.server_url
        ))
        .json(&serde_json::json!({ "email": user.email.to_string() }))
        .send()
        .await
        .unwrap();

    assert_eq!(resend_response.status(), StatusCode::BAD_REQUEST);
    assert!(
        resend_response
            .text()
            .await
            .unwrap()
            .contains("user already verified")
    );
}

#[tokio::test]
async fn test_resend_verification_email_cooldown_not_elapsed_400() {
    let instance_state = setup_instance(&TestConfigBuilder::new().with_otp_cooldown(10).build())
        .await
        .unwrap();

    let (user, _password) = instance_state.signup_user().await;

    let resend_response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/resend-verification-otp",
            &instance_state.server_url
        ))
        .json(&serde_json::json!({ "email": user.email.to_string() }))
        .send()
        .await
        .unwrap();

    assert_eq!(resend_response.status(), StatusCode::BAD_REQUEST);
    assert!(
        resend_response
            .text()
            .await
            .unwrap()
            .contains("cooldown period has not elapsed yet for requesting a new verification code")
    );
}

#[tokio::test]
async fn test_resend_verification_email_rate_limit_429() {
    let instance_state = setup_instance(
        &TestConfigBuilder::new()
            .with_otp_cooldown(3)
            .with_auth_rate_limit(3, 1)
            .build(),
    )
    .await
    .unwrap();

    let (user, _password) = instance_state.signup_user().await;

    // Wait for 4 seconds to ensure the cooldown period has passed and rate limiting bucket has been filled up again
    tokio::time::sleep(Duration::from_secs(4)).await;

    let resend_response_0 = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/resend-verification-otp",
            &instance_state.server_url
        ))
        .json(&serde_json::json!({ "email": user.email.to_string() }))
        .send()
        .await
        .unwrap();
    let resend_response_1 = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/resend-verification-otp",
            &instance_state.server_url
        ))
        .json(&serde_json::json!({ "email": user.email.to_string() }))
        .send()
        .await
        .unwrap();
    let resend_response_2 = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/resend-verification-otp",
            &instance_state.server_url
        ))
        .json(&serde_json::json!({ "email": user.email.to_string() }))
        .send()
        .await
        .unwrap();

    assert_eq!(resend_response_0.status(), StatusCode::OK);
    assert_eq!(resend_response_1.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(resend_response_2.status(), StatusCode::TOO_MANY_REQUESTS);
}
