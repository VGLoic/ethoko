use axum::http::StatusCode;
use ethoko_central::jobs::queue::QueueInspector;
use ethoko_central::{
    auth::requests::signup_email::{HttpSignupEmailBody, HttpSignupEmailResponse},
    externalcom::email::EmailTemplate,
    newtypes::{email::Email, password::Password},
};
use fake::{Fake, Faker};
use std::{sync::atomic::Ordering, time::Duration};
mod common;
use common::{
    AuthActions, InstanceState, TestConfigBuilder, central_ui_bff_principal_headers, setup_instance,
};

// These tests control worker execution; the shared signup action processes jobs.
async fn signup(instance: &InstanceState) -> Email {
    let email = Faker.fake::<Email>();
    let password = Faker.fake::<Password>();
    let response = instance
        .reqwest_client
        .post(format!("{}/auth/signup/email", instance.server_url))
        .headers(central_ui_bff_principal_headers())
        .json(&HttpSignupEmailBody {
            email: email.to_string(),
            password: password.as_str().to_owned(),
        })
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    response
        .json::<HttpSignupEmailResponse>()
        .await
        .unwrap()
        .email
}

#[tokio::test]
async fn signup_starts_cooldown_before_worker_and_verifies_only_after_filling() {
    let instance = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();
    let email = signup(&instance).await;
    assert!(instance.verification_codes(&email).is_empty());
    let response = instance.verify_email(&email, "123456").await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        response.json::<serde_json::Value>().await.unwrap()["code"],
        "ETKAVE02"
    );
    let response = instance.resend_verification_otp(&email).await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        response.json::<serde_json::Value>().await.unwrap()["code"],
        "ETKARV02"
    );
    instance.job_worker.consume_jobs().await.unwrap();
    let codes = instance.verification_codes(&email);
    assert_eq!(codes.len(), 1);
    assert_eq!(
        instance.verify_email(&email, &codes[0]).await.status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn expired_unfilled_request_is_skipped_without_email_or_retry() {
    let instance = setup_instance(&TestConfigBuilder::new().with_otp_ttl(1).build())
        .await
        .unwrap();
    let email = signup(&instance).await;
    tokio::time::sleep(Duration::from_millis(1200)).await;
    instance.job_worker.consume_jobs().await.unwrap();
    assert!(instance.verification_codes(&email).is_empty());
    assert!(
        instance
            .job_queue
            .inner
            .pending_jobs()
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        instance
            .job_queue
            .inner
            .successful_jobs()
            .await
            .unwrap()
            .len(),
        1
    );
    let response = instance.verify_email(&email, "123456").await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        response.json::<serde_json::Value>().await.unwrap()["code"],
        "ETKAVE03"
    );
}

#[tokio::test]
async fn enqueue_failure_preserves_signup_and_cooldown_and_later_resend_recovers() {
    let instance = setup_instance(&TestConfigBuilder::new().with_otp_cooldown(1).build())
        .await
        .unwrap();
    instance
        .job_queue
        .fail_enqueue
        .store(true, Ordering::SeqCst);
    let email = signup(&instance).await;
    assert_eq!(
        instance.resend_verification_otp(&email).await.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        instance.verify_email(&email, "123456").await.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    instance.job_worker.consume_jobs().await.unwrap();
    assert!(instance.verification_codes(&email).is_empty());
    instance
        .job_queue
        .fail_enqueue
        .store(false, Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(1200)).await;
    assert_eq!(
        instance.resend_verification_otp(&email).await.status(),
        StatusCode::OK
    );
    instance.job_worker.consume_jobs().await.unwrap();
    assert_eq!(
        instance
            .verify_email(&email, &instance.verification_codes(&email)[0])
            .await
            .status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn retry_replaces_assigned_code_without_renewing_cooldown() {
    let instance = setup_instance(&TestConfigBuilder::new().with_otp_cooldown(4).build())
        .await
        .unwrap();
    // On the rare random-code collision, repeat the scenario rather than assert
    // that independent random generation must produce distinct values.
    loop {
        instance
            .email_service
            .fail_sending
            .store(true, Ordering::SeqCst);
        let email = signup(&instance).await;
        instance.job_worker.consume_jobs().await.unwrap();
        let first = match &instance
            .email_service
            .attempts
            .lock()
            .unwrap()
            .last()
            .unwrap()
            .1
        {
            EmailTemplate::EmailVerificationCode(payload) => payload.otp.show().to_owned(),
        };
        assert!(instance.verification_codes(&email).is_empty());
        instance
            .email_service
            .fail_sending
            .store(false, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(2200)).await;
        instance.job_worker.consume_jobs().await.unwrap();
        let latest = instance.verification_codes(&email)[0].clone();
        assert_eq!(
            instance.resend_verification_otp(&email).await.status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        if first == latest {
            continue;
        }
        let response = instance.verify_email(&email, &first).await;
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            response.json::<serde_json::Value>().await.unwrap()["code"],
            "ETKAVE02"
        );
        // Cooldown ends at creation + 4s, not at retry + 4s.
        tokio::time::sleep(Duration::from_millis(2100)).await;
        assert_eq!(
            instance.resend_verification_otp(&email).await.status(),
            StatusCode::OK
        );
        // Resend replaces immediately, before its filling work runs.
        assert_eq!(
            instance.verify_email(&email, &latest).await.status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        instance.job_worker.consume_jobs().await.unwrap();
        assert_eq!(instance.verification_codes(&email).len(), 2);
        assert_eq!(
            instance
                .verify_email(&email, &instance.verification_codes(&email)[1])
                .await
                .status(),
            StatusCode::OK
        );
        break;
    }
}

#[tokio::test]
async fn retry_does_not_extend_request_expiry() {
    let instance = setup_instance(&TestConfigBuilder::new().with_otp_ttl(4).build())
        .await
        .unwrap();
    let email = signup(&instance).await;
    instance
        .email_service
        .fail_sending
        .store(true, Ordering::SeqCst);
    instance.job_worker.consume_jobs().await.unwrap();
    instance
        .email_service
        .fail_sending
        .store(false, Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(2200)).await;
    instance.job_worker.consume_jobs().await.unwrap();
    let code = instance.verification_codes(&email)[0].clone();
    tokio::time::sleep(Duration::from_millis(2100)).await;
    let response = instance.verify_email(&email, &code).await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        response.json::<serde_json::Value>().await.unwrap()["code"],
        "ETKAVE03"
    );
}

#[tokio::test]
async fn obsolete_signup_job_cannot_fill_replacement_request() {
    let instance = setup_instance(&TestConfigBuilder::new().with_otp_cooldown(0).build())
        .await
        .unwrap();
    let email = signup(&instance).await;
    // Hold the signup job while resend commits and fills a replacement.
    use ethoko_central::jobs::queue::Queue;
    let held = instance.job_queue.dequeue().await.unwrap().unwrap();
    assert_eq!(
        instance.resend_verification_otp(&email).await.status(),
        StatusCode::OK
    );
    instance.job_worker.consume_jobs().await.unwrap();
    let code = instance.verification_codes(&email)[0].clone();
    instance.job_worker.process_job(&held).await.unwrap();
    assert_eq!(instance.verification_codes(&email).len(), 1);
    assert_eq!(
        instance.verify_email(&email, &code).await.status(),
        StatusCode::OK
    );
}
