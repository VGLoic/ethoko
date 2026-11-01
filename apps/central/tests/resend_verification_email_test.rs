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
    let first_otp = verification_codes(&instance_state, &user.email)[0].clone();

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

    assert_eq!(resend_response.status(), StatusCode::OK);
    // Replacement is committed even though its filling job has not run.
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
    assert_eq!(
        verify(&instance_state, &user.email, "123456")
            .await
            .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(verification_codes(&instance_state, &user.email).len(), 1);

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
async fn verification_and_replacement_have_consistent_outcomes() {
    let instance = setup_instance(&TestConfigBuilder::new().with_otp_cooldown(0).build())
        .await
        .unwrap();

    for _ in 0..8 {
        let (user, _) = instance.signup_user().await;
        let original = verification_codes(&instance, &user.email)[0].clone();
        let (verification, replacement) = tokio::join!(
            verify(&instance, &user.email, &original),
            resend(&instance, &user.email)
        );
        instance.job_worker.consume_jobs().await.unwrap();

        if verification.status() == StatusCode::OK {
            assert_eq!(replacement.status(), StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(verification_codes(&instance, &user.email).len(), 1);
            assert_eq!(
                verification.json::<serde_json::Value>().await.unwrap()["emailVerified"],
                true
            );
        } else {
            assert_eq!(replacement.status(), StatusCode::OK);
            // Replacement won: the superseded code cannot verify, but the
            // freshly delivered current code remains usable.
            assert_eq!(verification.status(), StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(
                verification
                    .json::<UnprocessableEntityError>()
                    .await
                    .unwrap()
                    .code,
                "ETKAVE02"
            );
            let codes = verification_codes(&instance, &user.email);
            assert_eq!(codes.len(), 2);
            let response = verify(&instance, &user.email, &codes[1]).await;
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(
                response.json::<serde_json::Value>().await.unwrap()["emailVerified"],
                true
            );
        }

        for code in verification_codes(&instance, &user.email) {
            let response = verify(&instance, &user.email, &code).await;
            assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(
                response
                    .json::<UnprocessableEntityError>()
                    .await
                    .unwrap()
                    .code,
                "ETKAVE01"
            );
        }
        let response = resend(&instance, &user.email).await;
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            response
                .json::<UnprocessableEntityError>()
                .await
                .unwrap()
                .code,
            "ETKARV01"
        );
    }
}

#[tokio::test]
async fn queued_filling_cannot_restart_consumed_verification() {
    use ethoko_central::jobs::queue::Queue;
    let instance = setup_instance(&TestConfigBuilder::new().with_otp_cooldown(0).build())
        .await
        .unwrap();
    let (user, _) = instance.signup_user().await;
    assert_eq!(
        resend(&instance, &user.email).await.status(),
        StatusCode::OK
    );
    let held = instance.job_queue.dequeue().await.unwrap().unwrap();
    instance.job_worker.process_job(&held).await.unwrap();
    let code = verification_codes(&instance, &user.email)[1].clone();
    assert_eq!(
        verify(&instance, &user.email, &code).await.status(),
        StatusCode::OK
    );
    instance.job_worker.process_job(&held).await.unwrap();
    assert_eq!(verification_codes(&instance, &user.email).len(), 2);
    for code in verification_codes(&instance, &user.email) {
        let response = verify(&instance, &user.email, &code).await;
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            response
                .json::<UnprocessableEntityError>()
                .await
                .unwrap()
                .code,
            "ETKAVE01"
        );
    }
    let response = resend(&instance, &user.email).await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        response
            .json::<UnprocessableEntityError>()
            .await
            .unwrap()
            .code,
        "ETKARV01"
    );
}

#[tokio::test]
async fn concurrent_resend_rejects_competitor_before_processing() {
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
    // Leave signup's linked notification queued in the initial-request case.
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

    // Request creation, not later worker execution, decides the winner.
    let (first, second) = tokio::join!(resend(&instance, &email), resend(&instance, &email));
    if replacement {
        let mut statuses = [first.status().as_u16(), second.status().as_u16()];
        statuses.sort();
        assert_eq!(statuses, [200, 422]);
        let rejected = if first.status() == StatusCode::OK {
            second
        } else {
            first
        };
        assert_eq!(
            rejected
                .json::<UnprocessableEntityError>()
                .await
                .unwrap()
                .code,
            "ETKARV02"
        );
    } else {
        assert_eq!(first.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(second.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

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

    let (first_worker, second_worker) = tokio::join!(
        instance.job_worker.consume_jobs(),
        instance.job_worker.consume_jobs()
    );
    first_worker.unwrap();
    second_worker.unwrap();
    // Only the synchronously accepted request delivers a replacement email.
    let codes = verification_codes(&instance, &email);
    assert_eq!(codes.len(), if replacement { 2 } else { 1 });
    let response = verify(&instance, &email, codes.last().unwrap()).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.json::<serde_json::Value>().await.unwrap()["emailVerified"],
        true
    );
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

#[tokio::test]
async fn enqueue_failure_commits_replacement_and_cooldown_then_later_resend_recovers() {
    use std::sync::atomic::Ordering;
    let instance = setup_instance(&TestConfigBuilder::new().with_otp_cooldown(2).build())
        .await
        .unwrap();
    let (user, _) = instance.signup_user().await;
    let old = verification_codes(&instance, &user.email)[0].clone();
    tokio::time::sleep(Duration::from_millis(2200)).await;
    instance
        .job_queue
        .fail_enqueue
        .store(true, Ordering::SeqCst);
    assert_eq!(
        resend(&instance, &user.email).await.status(),
        StatusCode::OK
    );
    assert_eq!(
        verify(&instance, &user.email, &old)
            .await
            .json::<UnprocessableEntityError>()
            .await
            .unwrap()
            .code,
        "ETKAVE02"
    );
    assert_eq!(
        resend(&instance, &user.email)
            .await
            .json::<UnprocessableEntityError>()
            .await
            .unwrap()
            .code,
        "ETKARV02"
    );
    instance.job_worker.consume_jobs().await.unwrap();
    assert_eq!(verification_codes(&instance, &user.email).len(), 1);
    instance
        .job_queue
        .fail_enqueue
        .store(false, Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(2200)).await;
    assert_eq!(
        resend(&instance, &user.email).await.status(),
        StatusCode::OK
    );
    instance.job_worker.consume_jobs().await.unwrap();
    let codes = verification_codes(&instance, &user.email);
    assert_eq!(codes.len(), 2);
    assert_eq!(
        verify(&instance, &user.email, &codes[1]).await.status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn replaced_resend_work_skips_before_and_after_replacement_filling() {
    use ethoko_central::jobs::queue::Queue;
    let instance = setup_instance(&TestConfigBuilder::new().with_otp_cooldown(0).build())
        .await
        .unwrap();
    let (user, _) = instance.signup_user().await;
    assert_eq!(
        resend(&instance, &user.email).await.status(),
        StatusCode::OK
    );
    let held = instance.job_queue.dequeue().await.unwrap().unwrap();
    assert_eq!(
        resend(&instance, &user.email).await.status(),
        StatusCode::OK
    );
    instance.job_worker.process_job(&held).await.unwrap();
    assert_eq!(verification_codes(&instance, &user.email).len(), 1);
    assert_eq!(
        verify(&instance, &user.email, "123456")
            .await
            .json::<UnprocessableEntityError>()
            .await
            .unwrap()
            .code,
        "ETKAVE02"
    );
    instance.job_worker.consume_jobs().await.unwrap();
    let code = verification_codes(&instance, &user.email)[1].clone();
    instance.job_worker.process_job(&held).await.unwrap();
    assert_eq!(verification_codes(&instance, &user.email).len(), 2);
    assert_eq!(
        verify(&instance, &user.email, &code).await.status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn delayed_resend_retry_preserves_creation_expiry_and_cooldown() {
    use std::sync::atomic::Ordering;
    let instance = setup_instance(
        &TestConfigBuilder::new()
            .with_otp_ttl(5)
            .with_otp_cooldown(4)
            .build(),
    )
    .await
    .unwrap();
    let (user, _) = instance.signup_user().await;
    tokio::time::sleep(Duration::from_millis(4200)).await;
    assert_eq!(
        resend(&instance, &user.email).await.status(),
        StatusCode::OK
    );
    // Queue delay uses part of the new request's lifetime before assignment.
    tokio::time::sleep(Duration::from_millis(1200)).await;
    instance
        .email_service
        .fail_sending
        .store(true, Ordering::SeqCst);
    instance.job_worker.consume_jobs().await.unwrap();
    assert_eq!(verification_codes(&instance, &user.email).len(), 1);
    instance
        .email_service
        .fail_sending
        .store(false, Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(2200)).await;
    instance.job_worker.consume_jobs().await.unwrap();
    let codes = verification_codes(&instance, &user.email);
    assert_eq!(codes.len(), 2); // Retry fills and sends inside creation cooldown.
    assert_eq!(
        resend(&instance, &user.email)
            .await
            .json::<UnprocessableEntityError>()
            .await
            .unwrap()
            .code,
        "ETKARV02"
    );
    tokio::time::sleep(Duration::from_millis(1800)).await;
    // Neither the delayed first assignment nor retry restarted expiry.
    assert_eq!(
        verify(&instance, &user.email, &codes[1])
            .await
            .json::<UnprocessableEntityError>()
            .await
            .unwrap()
            .code,
        "ETKAVE03"
    );
    assert_eq!(
        resend(&instance, &user.email).await.status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn resend_retry_delivers_a_usable_code_inside_creation_cooldown() {
    use std::sync::atomic::Ordering;
    let instance = setup_instance(&TestConfigBuilder::new().with_otp_cooldown(4).build())
        .await
        .unwrap();
    let (user, _) = instance.signup_user().await;
    tokio::time::sleep(Duration::from_millis(4200)).await;
    assert_eq!(
        resend(&instance, &user.email).await.status(),
        StatusCode::OK
    );
    instance
        .email_service
        .fail_sending
        .store(true, Ordering::SeqCst);
    instance.job_worker.consume_jobs().await.unwrap();
    assert_eq!(verification_codes(&instance, &user.email).len(), 1);
    instance
        .email_service
        .fail_sending
        .store(false, Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(2200)).await;
    instance.job_worker.consume_jobs().await.unwrap();
    let codes = verification_codes(&instance, &user.email);
    assert_eq!(codes.len(), 2);
    assert_eq!(
        resend(&instance, &user.email)
            .await
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
async fn resend_expiring_before_processing_sends_no_email() {
    let instance = setup_instance(
        &TestConfigBuilder::new()
            .with_otp_ttl(1)
            .with_otp_cooldown(0)
            .build(),
    )
    .await
    .unwrap();
    let (user, _) = instance.signup_user().await;
    assert_eq!(
        resend(&instance, &user.email).await.status(),
        StatusCode::OK
    );
    tokio::time::sleep(Duration::from_millis(1200)).await;
    instance.job_worker.consume_jobs().await.unwrap();
    instance.job_worker.consume_jobs().await.unwrap();
    assert_eq!(verification_codes(&instance, &user.email).len(), 1);
    assert_eq!(
        verify(&instance, &user.email, "123456")
            .await
            .json::<UnprocessableEntityError>()
            .await
            .unwrap()
            .code,
        "ETKAVE03"
    );
}

#[tokio::test]
async fn filling_replacement_and_verification_share_committed_order() {
    use ethoko_central::jobs::queue::Queue;
    let instance = setup_instance(&TestConfigBuilder::new().with_otp_cooldown(0).build())
        .await
        .unwrap();
    for _ in 0..8 {
        let (user, _) = instance.signup_user().await;
        assert_eq!(
            resend(&instance, &user.email).await.status(),
            StatusCode::OK
        );
        let held = instance.job_queue.dequeue().await.unwrap().unwrap();
        instance.job_worker.process_job(&held).await.unwrap();
        let code = verification_codes(&instance, &user.email)[1].clone();
        let (filling, replacement, verification) = tokio::join!(
            instance.job_worker.process_job(&held),
            resend(&instance, &user.email),
            verify(&instance, &user.email, &code)
        );
        filling.unwrap();
        if verification.status() == StatusCode::OK {
            assert_eq!(replacement.status(), StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(
                replacement
                    .json::<UnprocessableEntityError>()
                    .await
                    .unwrap()
                    .code,
                "ETKARV01"
            );
            let count = verification_codes(&instance, &user.email).len();
            instance.job_worker.process_job(&held).await.unwrap();
            assert_eq!(verification_codes(&instance, &user.email).len(), count);
        } else {
            assert_eq!(verification.status(), StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(
                verification
                    .json::<UnprocessableEntityError>()
                    .await
                    .unwrap()
                    .code,
                "ETKAVE02"
            );
            assert_eq!(replacement.status(), StatusCode::OK);
            // Wait for all overlapping sends before filling the new request.
            // No guarantee is made about delivery order after assignment commits.
            let count = verification_codes(&instance, &user.email).len();
            instance.job_worker.process_job(&held).await.unwrap();
            assert_eq!(verification_codes(&instance, &user.email).len(), count);
            instance.job_worker.consume_jobs().await.unwrap();
            let codes = verification_codes(&instance, &user.email);
            assert_eq!(codes.len(), count + 1);
            assert_eq!(
                verify(&instance, &user.email, codes.last().unwrap())
                    .await
                    .status(),
                StatusCode::OK
            );
        }
    }
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
