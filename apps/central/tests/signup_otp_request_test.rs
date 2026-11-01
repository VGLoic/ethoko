use axum::http::StatusCode;
use ethoko_central::jobs::queue::QueueInspector;
use ethoko_central::{externalcom::email::EmailTemplate, newtypes::email::Email};
use fake::{Fake, Faker};
use std::{sync::atomic::Ordering, time::Duration};
mod common;
use common::{InstanceState, TestConfigBuilder, central_ui_bff_principal_headers, setup_instance};

async fn post(instance: &InstanceState, path: &str, body: serde_json::Value) -> reqwest::Response {
    instance
        .reqwest_client
        .post(format!("{}/auth/{path}", instance.server_url))
        .headers(central_ui_bff_principal_headers())
        .json(&body)
        .send()
        .await
        .unwrap()
}

async fn signup(instance: &InstanceState) -> Email {
    let email = Faker.fake::<Email>();
    assert_eq!(
        post(
            instance,
            "signup/email",
            serde_json::json!({"email": email, "password": "Password123!"})
        )
        .await
        .status(),
        StatusCode::CREATED
    );
    email
}

async fn verify(instance: &InstanceState, email: &Email, otp: &str) -> reqwest::Response {
    post(
        instance,
        "verify-email",
        serde_json::json!({"email": email, "otp": otp}),
    )
    .await
}

async fn resend(instance: &InstanceState, email: &Email) -> reqwest::Response {
    post(
        instance,
        "resend-verification-otp",
        serde_json::json!({"email": email}),
    )
    .await
}

fn codes(instance: &InstanceState, email: &Email) -> Vec<String> {
    instance
        .email_service
        .get_emails_sent_to(email)
        .iter()
        .map(|template| match template {
            EmailTemplate::EmailVerificationCode(payload) => payload.otp.show().to_owned(),
        })
        .collect()
}

#[tokio::test]
async fn signup_starts_cooldown_before_worker_and_verifies_only_after_filling() {
    let instance = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();
    let email = signup(&instance).await;
    assert!(codes(&instance, &email).is_empty());
    let response = verify(&instance, &email, "123456").await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        response.json::<serde_json::Value>().await.unwrap()["code"],
        "ETKAVE02"
    );
    let response = resend(&instance, &email).await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        response.json::<serde_json::Value>().await.unwrap()["code"],
        "ETKARV02"
    );
    instance.job_worker.consume_jobs().await.unwrap();
    let codes = codes(&instance, &email);
    assert_eq!(codes.len(), 1);
    assert_eq!(
        verify(&instance, &email, &codes[0]).await.status(),
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
    assert!(codes(&instance, &email).is_empty());
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
    let response = verify(&instance, &email, "123456").await;
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
        resend(&instance, &email).await.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        verify(&instance, &email, "123456").await.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    instance.job_worker.consume_jobs().await.unwrap();
    assert!(codes(&instance, &email).is_empty());
    instance
        .job_queue
        .fail_enqueue
        .store(false, Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(1200)).await;
    assert_eq!(resend(&instance, &email).await.status(), StatusCode::OK);
    instance.job_worker.consume_jobs().await.unwrap();
    assert_eq!(
        verify(&instance, &email, &codes(&instance, &email)[0])
            .await
            .status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn initial_request_failure_rolls_back_identity_and_credential() {
    let instance = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();
    let email = Faker.fake::<Email>();
    let fault = instance.fail_otp_writes(&email, "INSERT").await;
    let body = serde_json::json!({"email": email, "password": "Password123!"});
    let response = post(&instance, "signup/email", body.clone()).await;
    instance.clear_otp_fault(&fault).await;
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
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
        post(&instance, "login/email", body.clone()).await.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        post(&instance, "signup/email", body).await.status(),
        StatusCode::CREATED
    );
    instance.job_worker.consume_jobs().await.unwrap();
    assert_eq!(codes(&instance, &email).len(), 1);
    assert_eq!(
        verify(&instance, &email, &codes(&instance, &email)[0])
            .await
            .status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn assignment_failure_does_not_send_and_queue_retry_recovers_inside_cooldown() {
    let instance = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();
    let email = signup(&instance).await;
    let fault = instance.fail_otp_writes(&email, "UPDATE").await;
    instance.job_worker.consume_jobs().await.unwrap();
    instance.clear_otp_fault(&fault).await;
    assert!(instance.email_service.attempts.lock().unwrap().is_empty());
    assert_eq!(
        instance.job_queue.inner.pending_jobs().await.unwrap().len(),
        1
    );
    tokio::time::sleep(Duration::from_millis(2200)).await;
    instance.job_worker.consume_jobs().await.unwrap();
    assert_eq!(codes(&instance, &email).len(), 1);
    assert_eq!(
        resend(&instance, &email).await.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        verify(&instance, &email, &codes(&instance, &email)[0])
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
        assert!(codes(&instance, &email).is_empty());
        instance
            .email_service
            .fail_sending
            .store(false, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(2200)).await;
        instance.job_worker.consume_jobs().await.unwrap();
        let latest = codes(&instance, &email)[0].clone();
        assert_eq!(
            resend(&instance, &email).await.status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        if first == latest {
            continue;
        }
        let response = verify(&instance, &email, &first).await;
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            response.json::<serde_json::Value>().await.unwrap()["code"],
            "ETKAVE02"
        );
        // Cooldown ends at creation + 4s, not at retry + 4s.
        tokio::time::sleep(Duration::from_millis(2100)).await;
        assert_eq!(resend(&instance, &email).await.status(), StatusCode::OK);
        // Legacy resend is queued but has not replaced the linked request yet.
        assert_eq!(
            verify(&instance, &email, &latest).await.status(),
            StatusCode::OK
        );
        instance.job_worker.consume_jobs().await.unwrap();
        assert_eq!(codes(&instance, &email).len(), 1);
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
    let code = codes(&instance, &email)[0].clone();
    tokio::time::sleep(Duration::from_millis(2100)).await;
    let response = verify(&instance, &email, &code).await;
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
    // Hold the signup job while the transitional resend creates a replacement.
    use ethoko_central::jobs::queue::Queue;
    let held = instance.job_queue.dequeue().await.unwrap().unwrap();
    assert_eq!(resend(&instance, &email).await.status(), StatusCode::OK);
    instance.job_worker.consume_jobs().await.unwrap();
    let code = codes(&instance, &email)[0].clone();
    instance.job_worker.process_job(&held).await.unwrap();
    assert_eq!(codes(&instance, &email).len(), 1);
    assert_eq!(
        verify(&instance, &email, &code).await.status(),
        StatusCode::OK
    );
}
