use axum::http::StatusCode;
use ethoko_central::{
    auth::http_responses::UserResponse,
    auth::requests::{
        login_github_callback::{HttpLoginGithubCallbackBody, HttpLoginGithubCallbackResponse},
        login_github_start::HttpLoginGithubStartResponse,
    },
    clients::github::models::{GithubApiUserEmailsResponseItem, GithubApiUserResponse},
    newtypes::{email::Email, handle::Handle},
    router::UnprocessableEntityError,
};
mod common;
use common::{AuthActions, TestConfigBuilder, central_ui_bff_principal_headers, setup_instance};
use fake::{Fake, Faker};

use crate::common::central_ui_bff_with_user_principal_headers;
use ethoko_central::jobs::queue::{Queue, QueueInspector};
use std::{sync::atomic::Ordering, time::Duration};

// Drive repeated GitHub authentication through HTTP without running the worker.
async fn github_login(
    instance: &common::InstanceState,
    github_user: &GithubApiUserResponse,
    email: &Email,
    verified: bool,
) -> reqwest::Response {
    instance.github_client.set_next_user(github_user.clone());
    instance
        .github_client
        .set_next_user_emails(vec![GithubApiUserEmailsResponseItem {
            email: email.to_string(),
            verified,
            primary: true,
        }]);
    let start = instance
        .reqwest_client
        .post(format!("{}/auth/login/github/start", instance.server_url))
        .headers(central_ui_bff_principal_headers())
        .send()
        .await
        .unwrap()
        .json::<HttpLoginGithubStartResponse>()
        .await
        .unwrap();
    instance
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/callback",
            instance.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .json(&HttpLoginGithubCallbackBody {
            code: instance.github_oauth_client.code().unwrap(),
            state: start.state,
        })
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn github_enqueue_failure_preserves_session_cooldown_and_resend_recovery() {
    let instance = setup_instance(&TestConfigBuilder::new().with_otp_cooldown(2).build())
        .await
        .unwrap();
    let email = Faker.fake::<Email>();
    let github_user = GithubApiUserResponse {
        id: Faker.fake::<u64>(),
        login: Faker.fake::<Handle>().to_string(),
    };
    instance
        .job_queue
        .fail_enqueue
        .store(true, Ordering::SeqCst);
    let response = github_login(&instance, &github_user, &email, false).await;
    assert_eq!(response.status(), StatusCode::OK);
    let token = response
        .json::<HttpLoginGithubCallbackResponse>()
        .await
        .unwrap()
        .token;
    let me = instance
        .reqwest_client
        .get(format!("{}/auth/me", instance.server_url))
        .headers(central_ui_bff_with_user_principal_headers(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(me.status(), StatusCode::OK);
    let user = me.json::<UserResponse>().await.unwrap();
    assert_eq!(user.email, email);
    assert!(!user.email_verified);
    assert!(user.handle_registration.is_none());
    assert_eq!(user.suggested_handle, Some(github_user.login));
    let response = instance.resend_verification_otp(&email).await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        response
            .json::<UnprocessableEntityError>()
            .await
            .unwrap()
            .code,
        "ETKARV02"
    );
    let response = instance.verify_email(&email, "123456").await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        response
            .json::<UnprocessableEntityError>()
            .await
            .unwrap()
            .code,
        "ETKAVE02"
    );
    instance.job_worker.consume_jobs().await.unwrap();
    assert!(instance.verification_codes(&email).is_empty());
    instance
        .job_queue
        .fail_enqueue
        .store(false, Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(2200)).await;
    assert_eq!(
        instance.resend_verification_otp(&email).await.status(),
        StatusCode::OK
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
async fn expired_github_signup_request_is_not_recreated_by_worker() {
    let instance = setup_instance(&TestConfigBuilder::new().with_otp_ttl(1).build())
        .await
        .unwrap();
    let email = Faker.fake::<Email>();
    let github_user = GithubApiUserResponse {
        id: Faker.fake::<u64>(),
        login: Faker.fake::<Handle>().to_string(),
    };
    assert_eq!(
        github_login(&instance, &github_user, &email, false)
            .await
            .status(),
        StatusCode::OK
    );
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
        response
            .json::<UnprocessableEntityError>()
            .await
            .unwrap()
            .code,
        "ETKAVE03"
    );
}

#[tokio::test]
async fn github_login_preserves_unverified_users_request_after_cooldown() {
    let instance = setup_instance(&TestConfigBuilder::new().with_otp_cooldown(0).build())
        .await
        .unwrap();
    let email = Faker.fake::<Email>();
    let github_user = GithubApiUserResponse {
        id: Faker.fake::<u64>(),
        login: Faker.fake::<Handle>().to_string(),
    };
    assert_eq!(
        github_login(&instance, &github_user, &email, false)
            .await
            .status(),
        StatusCode::OK
    );
    instance.job_worker.consume_jobs().await.unwrap();
    let codes = instance.verification_codes(&email);
    assert_eq!(codes.len(), 1);
    assert_eq!(
        github_login(&instance, &github_user, &email, false)
            .await
            .status(),
        StatusCode::OK
    );
    assert!(instance.job_queue.dequeue().await.unwrap().is_none());
    instance.job_worker.consume_jobs().await.unwrap();
    assert_eq!(instance.verification_codes(&email).len(), 1);
    // A replacement request would invalidate this previously assigned code.
    assert_eq!(
        instance.verify_email(&email, &codes[0]).await.status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn github_verified_signup_and_login_skip_verification_work() {
    let instance = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();
    let email = Faker.fake::<Email>();
    let github_user = GithubApiUserResponse {
        id: Faker.fake::<u64>(),
        login: Faker.fake::<Handle>().to_string(),
    };
    for _ in 0..2 {
        assert_eq!(
            github_login(&instance, &github_user, &email, true)
                .await
                .status(),
            StatusCode::OK
        );
        assert!(instance.job_queue.dequeue().await.unwrap().is_none());
        instance.job_worker.consume_jobs().await.unwrap();
        assert!(instance.verification_codes(&email).is_empty());
    }
}

#[tokio::test]
async fn obsolete_github_signup_job_cannot_fill_resend_replacement() {
    let instance = setup_instance(&TestConfigBuilder::new().with_otp_cooldown(0).build())
        .await
        .unwrap();
    let email = Faker.fake::<Email>();
    let github_user = GithubApiUserResponse {
        id: Faker.fake::<u64>(),
        login: Faker.fake::<Handle>().to_string(),
    };
    assert_eq!(
        github_login(&instance, &github_user, &email, false)
            .await
            .status(),
        StatusCode::OK
    );
    let held = instance.job_queue.dequeue().await.unwrap().unwrap();
    assert_eq!(
        instance.resend_verification_otp(&email).await.status(),
        StatusCode::OK
    );
    instance.job_worker.consume_jobs().await.unwrap();
    let codes = instance.verification_codes(&email);
    assert_eq!(codes.len(), 1);
    instance.job_worker.process_job(&held).await.unwrap();
    assert_eq!(instance.verification_codes(&email).len(), 1);
    assert_eq!(
        instance.verify_email(&email, &codes[0]).await.status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn unverified_github_signup_starts_cooldown_before_filling() {
    let instance = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();
    let email = Faker.fake::<Email>();
    instance.github_client.set_next_user(GithubApiUserResponse {
        id: Faker.fake::<u64>(),
        login: Faker.fake::<Handle>().to_string(),
    });
    instance
        .github_client
        .set_next_user_emails(vec![GithubApiUserEmailsResponseItem {
            email: email.to_string(),
            verified: false,
            primary: true,
        }]);
    let start = instance
        .reqwest_client
        .post(format!("{}/auth/login/github/start", instance.server_url))
        .headers(central_ui_bff_principal_headers())
        .send()
        .await
        .unwrap()
        .json::<HttpLoginGithubStartResponse>()
        .await
        .unwrap();
    let response = instance
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/callback",
            instance.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .json(&HttpLoginGithubCallbackBody {
            code: instance.github_oauth_client.code().unwrap(),
            state: start.state,
        })
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let (first, second) = tokio::join!(
        instance.resend_verification_otp(&email),
        instance.resend_verification_otp(&email)
    );
    for rejected in [first, second] {
        assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            rejected
                .json::<UnprocessableEntityError>()
                .await
                .unwrap()
                .code,
            "ETKARV02"
        );
    }
    assert!(instance.verification_codes(&email).is_empty());
    assert_eq!(
        instance
            .verify_email(&email, "123456")
            .await
            .json::<UnprocessableEntityError>()
            .await
            .unwrap()
            .code,
        "ETKAVE02"
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
async fn test_login_github_start_201() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/start",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    assert!(
        response
            .json::<HttpLoginGithubStartResponse>()
            .await
            .is_ok()
    );
}

#[tokio::test]
async fn test_login_github_start_401_without_bff_credential() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/start",
            &instance_state.server_url
        ))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_login_github_callback_401_without_bff_credential() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/callback",
            &instance_state.server_url
        ))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_login_github_callback_422_with_not_found_state() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/callback",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .json(&HttpLoginGithubCallbackBody {
            code: "some_code".to_string(),
            state: "not_found_state".to_string(),
        })
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = response.json::<UnprocessableEntityError>().await.unwrap();
    assert_eq!(error.code, "ETKLGC02");
}

#[tokio::test]
async fn test_login_github_callback_422_with_expired_state() {
    let instance_state = setup_instance(
        &TestConfigBuilder::new()
            .with_oauth_transaction_ttl_seconds(1)
            .build(),
    )
    .await
    .unwrap();

    let start_response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/start",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .send()
        .await
        .unwrap()
        .json::<HttpLoginGithubStartResponse>()
        .await
        .unwrap();

    tokio::time::sleep(std::time::Duration::from_secs(2)).await;

    let response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/callback",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .json(&HttpLoginGithubCallbackBody {
            code: "some_code".to_string(),
            state: start_response.state,
        })
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = response.json::<UnprocessableEntityError>().await.unwrap();
    assert_eq!(error.code, "ETKLGC03");
}

#[tokio::test]
async fn test_login_github_callback_422_with_already_taken_email() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let (already_signed_up_user, _password) = instance_state.signup_user().await;

    let start_response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/start",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .send()
        .await
        .unwrap()
        .json::<HttpLoginGithubStartResponse>()
        .await
        .unwrap();

    let github_user = GithubApiUserResponse {
        id: Faker.fake::<u64>(),
        login: Faker.fake::<Handle>().to_string(),
    };
    let github_user_emails = vec![GithubApiUserEmailsResponseItem {
        email: already_signed_up_user.email.to_string(),
        verified: true,
        primary: true,
    }];

    instance_state.github_client.set_next_user(github_user);
    instance_state
        .github_client
        .set_next_user_emails(github_user_emails);

    let response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/callback",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .json(&HttpLoginGithubCallbackBody {
            code: instance_state.github_oauth_client.code().unwrap(),
            state: start_response.state,
        })
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = response.json::<UnprocessableEntityError>().await.unwrap();
    assert_eq!(error.code, "ETKLGC01");
}

#[tokio::test]
async fn test_login_github_callback_500_with_invalid_code() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let email = Faker.fake::<Email>();
    let github_user = GithubApiUserResponse {
        id: Faker.fake::<u64>(),
        login: Faker.fake::<Handle>().to_string(),
    };
    let github_user_emails = vec![GithubApiUserEmailsResponseItem {
        email: email.to_string(),
        verified: true,
        primary: true,
    }];

    let start_response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/start",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .send()
        .await
        .unwrap()
        .json::<HttpLoginGithubStartResponse>()
        .await
        .unwrap();

    instance_state.github_client.set_next_user(github_user);
    instance_state
        .github_client
        .set_next_user_emails(github_user_emails);

    let response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/callback",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .json(&HttpLoginGithubCallbackBody {
            code: "some_code".to_string(),
            state: start_response.state,
        })
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn test_login_github_callback_200_with_newly_created_user() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let email = Faker.fake::<Email>();
    let github_user = GithubApiUserResponse {
        id: Faker.fake::<u64>(),
        login: Faker.fake::<Handle>().to_string(),
    };
    let expected_suggested_handle = github_user.login.clone();
    let github_user_emails = vec![GithubApiUserEmailsResponseItem {
        email: email.to_string(),
        verified: true,
        primary: true,
    }];

    let start_response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/start",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .send()
        .await
        .unwrap()
        .json::<HttpLoginGithubStartResponse>()
        .await
        .unwrap();

    instance_state.github_client.set_next_user(github_user);
    instance_state
        .github_client
        .set_next_user_emails(github_user_emails);

    let response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/callback",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .json(&HttpLoginGithubCallbackBody {
            code: instance_state.github_oauth_client.code().unwrap(),
            state: start_response.state,
        })
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let response_body: HttpLoginGithubCallbackResponse = response.json().await.unwrap();
    assert!(response_body.token.starts_with("etks_"));

    let me_response = instance_state
        .reqwest_client
        .get(format!("{}/auth/me", &instance_state.server_url))
        .headers(central_ui_bff_with_user_principal_headers(
            &response_body.token,
        ))
        .send()
        .await
        .unwrap();

    assert_eq!(me_response.status(), StatusCode::OK);
    let body: serde_json::Value = me_response.json().await.unwrap();
    assert_eq!(
        body.get("handle_registration"),
        Some(&serde_json::Value::Null)
    );
    let me_body: UserResponse = serde_json::from_value(body).unwrap();
    assert_eq!(me_body.email, email);
    assert_eq!(me_body.suggested_handle, Some(expected_suggested_handle));
    assert!(me_body.handle_registration.is_none());
    assert!(me_body.email_verified);
}

#[tokio::test]
async fn test_login_github_callback_200_with_newly_created_unverified_user_trigger_otp_email_sending()
 {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let email = Faker.fake::<Email>();
    let github_user = GithubApiUserResponse {
        id: Faker.fake::<u64>(),
        login: Faker.fake::<Handle>().to_string(),
    };
    let github_user_emails = vec![GithubApiUserEmailsResponseItem {
        email: email.to_string(),
        verified: false,
        primary: true,
    }];

    let start_response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/start",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .send()
        .await
        .unwrap()
        .json::<HttpLoginGithubStartResponse>()
        .await
        .unwrap();

    instance_state.github_client.set_next_user(github_user);
    instance_state
        .github_client
        .set_next_user_emails(github_user_emails);

    let response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/callback",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .json(&HttpLoginGithubCallbackBody {
            code: instance_state.github_oauth_client.code().unwrap(),
            state: start_response.state,
        })
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    instance_state.job_worker.consume_jobs().await.unwrap();

    assert!(instance_state.email_service.has_sent_email_to(&email))
}

#[tokio::test]
async fn test_login_github_callback_200_with_existing_user() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let email = Faker.fake::<Email>();
    let github_user = GithubApiUserResponse {
        id: Faker.fake::<u64>(),
        login: Faker.fake::<Handle>().to_string(),
    };
    let expected_suggested_handle = github_user.login.clone();
    let github_user_emails = vec![GithubApiUserEmailsResponseItem {
        email: email.to_string(),
        verified: true,
        primary: true,
    }];

    // First cycle: create the user by going through the GitHub login flow

    let start_response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/start",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .send()
        .await
        .unwrap()
        .json::<HttpLoginGithubStartResponse>()
        .await
        .unwrap();

    instance_state
        .github_client
        .set_next_user(github_user.clone());
    instance_state
        .github_client
        .set_next_user_emails(github_user_emails.clone());

    instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/callback",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .json(&HttpLoginGithubCallbackBody {
            code: instance_state.github_oauth_client.code().unwrap(),
            state: start_response.state,
        })
        .send()
        .await
        .unwrap();

    // Second cycle: attempt to log in with the existing user

    let start_response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/start",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .send()
        .await
        .unwrap()
        .json::<HttpLoginGithubStartResponse>()
        .await
        .unwrap();

    instance_state.github_client.set_next_user(github_user);
    instance_state
        .github_client
        .set_next_user_emails(github_user_emails);

    let response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/callback",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .json(&HttpLoginGithubCallbackBody {
            code: instance_state.github_oauth_client.code().unwrap(),
            state: start_response.state,
        })
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let response_body: HttpLoginGithubCallbackResponse = response.json().await.unwrap();
    assert!(response_body.token.starts_with("etks_"));

    let me_response = instance_state
        .reqwest_client
        .get(format!("{}/auth/me", &instance_state.server_url))
        .headers(central_ui_bff_with_user_principal_headers(
            &response_body.token,
        ))
        .send()
        .await
        .unwrap();

    assert_eq!(me_response.status(), StatusCode::OK);
    let me_body: UserResponse = me_response.json().await.unwrap();
    assert_eq!(me_body.email, email);
    assert_eq!(me_body.suggested_handle, Some(expected_suggested_handle));
    assert!(me_body.handle_registration.is_none());
    assert!(me_body.email_verified);
}

#[tokio::test]
async fn test_login_github_callback_422_with_existing_user_email_collision() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let (existing_user, _password) = instance_state.signup_user().await;

    let start_response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/start",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .send()
        .await
        .unwrap()
        .json::<HttpLoginGithubStartResponse>()
        .await
        .unwrap();

    let github_user = GithubApiUserResponse {
        id: Faker.fake::<u64>(),
        login: Faker.fake::<Handle>().to_string(),
    };
    let github_user_emails = vec![GithubApiUserEmailsResponseItem {
        email: existing_user.email.to_string(),
        verified: false,
        primary: true,
    }];

    instance_state.github_client.set_next_user(github_user);
    instance_state
        .github_client
        .set_next_user_emails(github_user_emails);

    let response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/callback",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .json(&HttpLoginGithubCallbackBody {
            code: instance_state.github_oauth_client.code().unwrap(),
            state: start_response.state,
        })
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = response.json::<UnprocessableEntityError>().await.unwrap();
    assert_eq!(error.code, "ETKLGC01");
}

#[tokio::test]
async fn test_login_github_token_valid() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let email = Faker.fake::<Email>();
    let github_user = GithubApiUserResponse {
        id: Faker.fake::<u64>(),
        login: Faker.fake::<Handle>().to_string(),
    };
    let expected_suggested_handle = github_user.login.clone();
    let github_user_emails = vec![GithubApiUserEmailsResponseItem {
        email: email.to_string(),
        verified: true,
        primary: true,
    }];

    let start_response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/start",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .send()
        .await
        .unwrap()
        .json::<HttpLoginGithubStartResponse>()
        .await
        .unwrap();

    instance_state.github_client.set_next_user(github_user);
    instance_state
        .github_client
        .set_next_user_emails(github_user_emails);

    let response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/callback",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .json(&HttpLoginGithubCallbackBody {
            code: instance_state.github_oauth_client.code().unwrap(),
            state: start_response.state,
        })
        .send()
        .await
        .unwrap()
        .json::<HttpLoginGithubCallbackResponse>()
        .await
        .unwrap();

    let me_response = instance_state
        .reqwest_client
        .get(format!("{}/auth/me", &instance_state.server_url))
        .headers(central_ui_bff_with_user_principal_headers(&response.token))
        .send()
        .await
        .unwrap();

    assert_eq!(me_response.status(), StatusCode::OK);
    let me_body: UserResponse = me_response.json().await.unwrap();
    assert_eq!(me_body.email, email);
    assert_eq!(me_body.suggested_handle, Some(expected_suggested_handle));
    assert!(me_body.handle_registration.is_none());
    assert!(me_body.email_verified);
}
