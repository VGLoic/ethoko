use std::time::Duration;

use axum::http::StatusCode;
use ethoko_central::{
    auth::requests::verify_email::HttpVerifyEmailBody, externalcom::email::EmailTemplate,
    newtypes::email::Email, router::UnprocessableEntityError,
};
mod common;
use common::{
    AuthActions, InstanceState, TestConfigBuilder, central_ui_bff_principal_headers, setup_instance,
};

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
        .headers(central_ui_bff_principal_headers())
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

    let first_otp = verification_codes(&instance_state, &user.email)[0].clone();
    let old_response = verify(&instance_state, &user.email, &first_otp).await;
    assert_eq!(old_response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        old_response
            .json::<UnprocessableEntityError>()
            .await
            .unwrap()
            .code,
        "ETKAVE02"
    );

    let verify_email_response = instance_state
        .reqwest_client
        .post(format!("{}/auth/verify-email", &instance_state.server_url))
        .headers(central_ui_bff_principal_headers())
        .json(&HttpVerifyEmailBody {
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
async fn replacement_invalidates_old_code_and_refreshes_expiry_and_cooldown() {
    let instance = setup_instance(
        &TestConfigBuilder::new()
            .with_otp_ttl(3)
            .with_otp_cooldown(1)
            .build(),
    )
    .await
    .unwrap();
    let (user, _) = instance.signup_user().await;
    let first_code = verification_codes(&instance, &user.email)[0].clone();

    tokio::time::sleep(Duration::from_secs(4)).await;
    assert_eq!(
        resend(&instance, &user.email).await.status(),
        StatusCode::OK
    );
    instance.job_worker.consume_jobs().await.unwrap();
    let codes = verification_codes(&instance, &user.email);
    assert_eq!(codes.len(), 2);

    // The expired request was replaced: the old code is now invalid, not expired.
    let old_response = verify(&instance, &user.email, &first_code).await;
    assert_eq!(old_response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        old_response
            .json::<UnprocessableEntityError>()
            .await
            .unwrap()
            .code,
        "ETKAVE02"
    );
    let cooldown_response = resend(&instance, &user.email).await;
    assert_eq!(cooldown_response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        cooldown_response
            .json::<UnprocessableEntityError>()
            .await
            .unwrap()
            .code,
        "ETKARV02"
    );
    assert_eq!(
        verify(&instance, &user.email, &codes[1]).await.status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn concurrent_resend_processing_preserves_current_verification_and_cooldown() {
    concurrent_issuance(true).await;
}

#[tokio::test]
async fn concurrent_first_issuance_preserves_current_verification_and_cooldown() {
    concurrent_issuance(false).await;
}

async fn concurrent_issuance(replacement: bool) {
    let instance = setup_instance(&TestConfigBuilder::new().with_otp_cooldown(2).build())
        .await
        .unwrap();
    // Leave signup's notification queued to also exercise the no-request-yet case.
    let email = Email::new(&format!("otp-{}@example.com", uuid::Uuid::new_v4())).unwrap();
    let signup = instance
        .reqwest_client
        .post(format!("{}/auth/signup/email", instance.server_url))
        .headers(central_ui_bff_principal_headers())
        .json(&serde_json::json!({ "email": email.to_string(), "password": "SecurePassword123!" }))
        .send()
        .await
        .unwrap();
    assert_eq!(signup.status(), StatusCode::CREATED);

    let old_code = if replacement {
        instance.job_worker.consume_jobs().await.unwrap();
        let code = verification_codes(&instance, &email)[0].clone();
        tokio::time::sleep(Duration::from_secs(3)).await;
        Some(code)
    } else {
        None
    };

    // HTTP acceptance only enqueues work; issuance and its authoritative cooldown
    // check happen later in the worker.
    let (first, second) = tokio::join!(resend(&instance, &email), resend(&instance, &email));
    assert_eq!(first.status(), StatusCode::OK);
    assert_eq!(second.status(), StatusCode::OK);
    let (first_worker, second_worker) = tokio::join!(
        instance.job_worker.consume_jobs(),
        instance.job_worker.consume_jobs()
    );
    first_worker.unwrap();
    second_worker.unwrap();

    let cooldown_response = resend(&instance, &email).await;
    assert_eq!(cooldown_response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        cooldown_response
            .json::<UnprocessableEntityError>()
            .await
            .unwrap()
            .code,
        "ETKARV02"
    );
    if let Some(code) = &old_code {
        let response = verify(&instance, &email, code).await;
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            response
                .json::<UnprocessableEntityError>()
                .await
                .unwrap()
                .code,
            "ETKAVE02"
        );
    }

    // Delivery ordering is unchanged in this slice: a rejected issuance can
    // still send an email. Do not assume the last delivered code is current.
    let codes = verification_codes(&instance, &email);
    let mut verified = false;
    for code in codes.iter().skip(usize::from(replacement)) {
        let response = verify(&instance, &email, code).await;
        if response.status() == StatusCode::OK {
            verified = true;
            break;
        }
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            response
                .json::<UnprocessableEntityError>()
                .await
                .unwrap()
                .code,
            "ETKAVE02"
        );
    }
    assert!(verified, "One of the delivered codes must verify the User");
}

fn verification_codes(instance: &InstanceState, email: &Email) -> Vec<String> {
    instance
        .email_service
        .get_emails_sent_to(email)
        .iter()
        .map(|template| match template {
            EmailTemplate::EmailVerificationCode(payload) => payload.otp.show().to_string(),
        })
        .collect()
}

async fn resend(instance: &InstanceState, email: &Email) -> reqwest::Response {
    instance
        .reqwest_client
        .post(format!(
            "{}/auth/resend-verification-otp",
            instance.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .json(&serde_json::json!({ "email": email.to_string() }))
        .send()
        .await
        .unwrap()
}

async fn verify(instance: &InstanceState, email: &Email, code: &str) -> reqwest::Response {
    instance
        .reqwest_client
        .post(format!("{}/auth/verify-email", instance.server_url))
        .headers(central_ui_bff_principal_headers())
        .json(&HttpVerifyEmailBody {
            email: email.to_string(),
            otp: code.to_string(),
        })
        .send()
        .await
        .unwrap()
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
        .headers(central_ui_bff_principal_headers())
        .json(&serde_json::json!({ "email": "invalid-email-format" }))
        .send()
        .await
        .unwrap();

    assert_eq!(resend_response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = resend_response
        .json::<UnprocessableEntityError>()
        .await
        .unwrap();
    assert_eq!(error.code, "ETKAG01");
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
        .headers(central_ui_bff_principal_headers())
        .json(&serde_json::json!({ "email": "nonexistent@example.com" }))
        .send()
        .await
        .unwrap();

    assert_eq!(resend_response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_resend_verification_email_user_already_verified_422() {
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
        .headers(central_ui_bff_principal_headers())
        .json(&HttpVerifyEmailBody {
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
        .headers(central_ui_bff_principal_headers())
        .json(&serde_json::json!({ "email": user.email.to_string() }))
        .send()
        .await
        .unwrap();

    assert_eq!(resend_response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = resend_response
        .json::<UnprocessableEntityError>()
        .await
        .unwrap();
    assert_eq!(error.code, "ETKARV01");
}

#[tokio::test]
async fn test_resend_verification_email_cooldown_not_elapsed_422() {
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
        .headers(central_ui_bff_principal_headers())
        .json(&serde_json::json!({ "email": user.email.to_string() }))
        .send()
        .await
        .unwrap();

    assert_eq!(resend_response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = resend_response
        .json::<UnprocessableEntityError>()
        .await
        .unwrap();
    assert_eq!(error.code, "ETKARV02");
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
        .headers(central_ui_bff_principal_headers())
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
        .headers(central_ui_bff_principal_headers())
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
        .headers(central_ui_bff_principal_headers())
        .json(&serde_json::json!({ "email": user.email.to_string() }))
        .send()
        .await
        .unwrap();

    assert_eq!(resend_response_0.status(), StatusCode::OK);
    assert_eq!(resend_response_1.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(resend_response_2.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn test_resend_verification_email_401_without_bff_credential() {
    let instance_state = setup_instance(&TestConfigBuilder::new().build())
        .await
        .unwrap();

    let response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/resend-verification-otp",
            &instance_state.server_url
        ))
        .json(&serde_json::json!({ "email": "user@example.com" }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
