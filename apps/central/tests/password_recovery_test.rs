mod common;

use common::{AuthActions, TestConfigBuilder, central_ui_bff_principal_headers, setup_instance};
use ethoko_central::{
    externalcom::email::EmailTemplate,
    newtypes::{email::Email, password::Password},
};
use reqwest::StatusCode;
use serde_json::json;

#[tokio::test]
async fn verification_resend_and_recovery_keep_tokens_and_cooldowns_isolated() {
    let instance = setup_instance(&TestConfigBuilder::new().with_otp_cooldown(0).build())
        .await
        .unwrap();
    let (user, _) = instance.signup_user().await;
    let token = request_link(&instance, &user.email).await;
    assert_eq!(
        post(
            &instance,
            "resend-verification-otp",
            json!({"email": user.email})
        )
        .await
        .status(),
        StatusCode::OK
    );
    instance.job_worker.consume_jobs().await.unwrap();
    let emails = instance.email_service.get_emails_sent_to(&user.email);
    assert_eq!(emails.len(), 3);
    let verification = emails
        .into_iter()
        .rev()
        .find_map(|template| match template {
            EmailTemplate::EmailVerificationCode(payload) => Some(payload.otp.show().to_string()),
            _ => None,
        })
        .unwrap();
    // A verification resend does not reset or bypass the recovery cooldown.
    assert_eq!(
        post(&instance, "forgot-password", json!({"email": user.email}))
            .await
            .status(),
        StatusCode::OK
    );
    instance.job_worker.consume_jobs().await.unwrap();
    assert_eq!(
        instance.email_service.get_emails_sent_to(&user.email).len(),
        3
    );
    assert_eq!(
        post(
            &instance,
            "reset-password",
            json!({"token": token, "password": "New-password1"})
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        post(
            &instance,
            "verify-email",
            json!({"email": user.email, "otp": verification})
        )
        .await
        .status(),
        StatusCode::OK
    );
}

async fn post(
    instance: &common::InstanceState,
    path: &str,
    body: serde_json::Value,
) -> reqwest::Response {
    instance
        .reqwest_client
        .post(format!("{}/auth/{path}", instance.server_url))
        .headers(central_ui_bff_principal_headers())
        .json(&body)
        .send()
        .await
        .unwrap()
}

async fn request_link(instance: &common::InstanceState, email: &Email) -> String {
    assert_eq!(
        post(instance, "forgot-password", json!({"email": email}))
            .await
            .status(),
        StatusCode::OK
    );
    instance.job_worker.consume_jobs().await.unwrap();
    instance
        .email_service
        .get_emails_sent_to(email)
        .into_iter()
        .rev()
        .find_map(|template| match template {
            EmailTemplate::PasswordReset(payload) => {
                let url = reqwest::Url::parse(&payload.reset_url("http://localhost:5173").unwrap())
                    .unwrap();
                assert_eq!(url.path(), "/reset-password");
                Some(
                    url.query_pairs()
                        .find(|(key, _)| key == "token")
                        .unwrap()
                        .1
                        .into_owned(),
                )
            }
            _ => None,
        })
        .expect("reset email")
}

#[tokio::test]
async fn recovery_replaces_password_revokes_sessions_and_preserves_pending_unverified_state() {
    let instance = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();
    let (user, password) = instance.signup_user().await;
    let sessions = [
        instance.login_user(&user.email, &password).await,
        instance.login_user(&user.email, &password).await,
    ];
    let token = request_link(&instance, &user.email).await;
    assert_eq!(token.len(), 64);
    assert_eq!(
        post(
            &instance,
            "reset-password",
            json!({"token": token, "password": "New-password1"})
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        post(
            &instance,
            "login/email",
            json!({"email": user.email, "password": password.as_str()})
        )
        .await
        .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    for token in sessions.into_iter().chain([token.clone()]) {
        let response = instance
            .reqwest_client
            .get(format!("{}/auth/me", instance.server_url))
            .headers(common::central_ui_bff_with_user_principal_headers(&token))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
    let session = instance
        .login_user(&user.email, &Password::new("New-password1").unwrap())
        .await;
    let profile: serde_json::Value = instance
        .reqwest_client
        .get(format!("{}/auth/me", instance.server_url))
        .headers(common::central_ui_bff_with_user_principal_headers(&session))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(profile["state"], "pending");
    assert_eq!(profile["emailVerified"], false);
    assert_eq!(
        post(
            &instance,
            "reset-password",
            json!({"token": token, "password": "Other-password2"})
        )
        .await
        .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
}

#[tokio::test]
async fn validation_retry_and_concurrent_completion_have_one_success() {
    let instance = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();
    let (user, _) = instance.signup_user().await;
    let token = request_link(&instance, &user.email).await;
    assert_eq!(
        post(
            &instance,
            "reset-password",
            json!({"token": token, "password": "weak"})
        )
        .await
        .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let body = json!({"token": token, "password": "New-password1"});
    let (first, second) = tokio::join!(
        post(&instance, "reset-password", body.clone()),
        post(&instance, "reset-password", body)
    );
    let mut statuses = [first.status().as_u16(), second.status().as_u16()];
    statuses.sort();
    assert_eq!(statuses, [200, 422]);
}

#[tokio::test]
async fn cooldown_normalizes_email_and_does_not_invalidate_current_link() {
    let mut config = TestConfigBuilder::build_default();
    config.password_reset_cooldown_seconds = 2;
    let instance = setup_instance(&config).await.unwrap();
    let (user, _) = instance.signup_user().await;
    let token = request_link(&instance, &user.email).await;
    let response = post(
        &instance,
        "forgot-password",
        json!({"email": format!("  {}  ", user.email.to_string().to_uppercase())}),
    )
    .await;
    assert_eq!(
        response.json::<serde_json::Value>().await.unwrap()["cooldownSeconds"],
        2
    );
    instance.job_worker.consume_jobs().await.unwrap();
    assert_eq!(
        instance.email_service.get_emails_sent_to(&user.email).len(),
        2
    );
    assert_eq!(
        post(
            &instance,
            "reset-password",
            json!({"token": token, "password": "New-password1"})
        )
        .await
        .status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn newest_recorded_token_wins_even_after_consumption_and_verification_is_independent() {
    let mut config = TestConfigBuilder::build_default();
    config.password_reset_cooldown_seconds = 0;
    let instance = setup_instance(&config).await.unwrap();
    let (user, _) = instance.signup_user().await;
    let verification = instance
        .email_service
        .get_emails_sent_to(&user.email)
        .into_iter()
        .find_map(|template| match template {
            EmailTemplate::EmailVerificationCode(payload) => Some(payload.otp.show().to_string()),
            _ => None,
        })
        .unwrap();
    let old = request_link(&instance, &user.email).await;
    // Merely queuing a request does not invalidate a recorded link.
    assert_eq!(
        post(&instance, "forgot-password", json!({"email": user.email}))
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        post(
            &instance,
            "reset-password",
            json!({"token": old, "password": "First-password1"})
        )
        .await
        .status(),
        StatusCode::OK
    );
    instance.job_worker.consume_jobs().await.unwrap();
    let newest = request_link(&instance, &user.email).await;
    let superseded = newest;
    let newest = request_link(&instance, &user.email).await;
    assert_eq!(
        post(
            &instance,
            "reset-password",
            json!({"token": superseded, "password": "New-password1"})
        )
        .await
        .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let invalid = post(
        &instance,
        "reset-password",
        json!({"token": old, "password": "New-password1"}),
    )
    .await
    .json::<serde_json::Value>()
    .await
    .unwrap();
    let unknown = post(
        &instance,
        "reset-password",
        json!({"token": "a".repeat(64), "password": "New-password1"}),
    )
    .await
    .json::<serde_json::Value>()
    .await
    .unwrap();
    assert_eq!(invalid, unknown);
    assert_eq!(
        post(
            &instance,
            "verify-email",
            json!({"email": user.email, "otp": verification})
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        post(
            &instance,
            "reset-password",
            json!({"token": newest, "password": "New-password1"})
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        post(
            &instance,
            "reset-password",
            json!({"token": old, "password": "New-password1"})
        )
        .await
        .json::<serde_json::Value>()
        .await
        .unwrap(),
        unknown
    );
}

#[tokio::test]
async fn registered_and_verified_states_are_independent_of_recovery() {
    for registered in [false, true] {
        for verified in [false, true] {
            let instance = setup_instance(&TestConfigBuilder::build_default())
                .await
                .unwrap();
            let (user, password) = instance.signup_user().await;
            let session = instance.login_user(&user.email, &password).await;
            if registered {
                let response = instance.reqwest_client.post(format!("{}/auth/register-handle", instance.server_url)).headers(common::central_ui_bff_with_user_principal_headers(&session)).json(&json!({"handle": format!("user-{}", &uuid::Uuid::new_v4().to_string()[..12])})).send().await.unwrap();
                assert_eq!(response.status(), StatusCode::OK);
            }
            if verified {
                let otp = instance
                    .email_service
                    .get_emails_sent_to(&user.email)
                    .into_iter()
                    .find_map(|template| match template {
                        EmailTemplate::EmailVerificationCode(payload) => {
                            Some(payload.otp.show().to_string())
                        }
                        _ => None,
                    })
                    .unwrap();
                assert_eq!(
                    post(
                        &instance,
                        "verify-email",
                        json!({"email": user.email, "otp": otp})
                    )
                    .await
                    .status(),
                    StatusCode::OK
                );
            }
            let before: serde_json::Value = instance
                .reqwest_client
                .get(format!("{}/auth/me", instance.server_url))
                .headers(common::central_ui_bff_with_user_principal_headers(&session))
                .send()
                .await
                .unwrap()
                .json()
                .await
                .unwrap();
            let token = request_link(&instance, &user.email).await;
            assert_eq!(
                post(
                    &instance,
                    "reset-password",
                    json!({"token": token, "password": "New-password1"})
                )
                .await
                .status(),
                StatusCode::OK
            );
            let session = instance
                .login_user(&user.email, &Password::new("New-password1").unwrap())
                .await;
            let after: serde_json::Value = instance
                .reqwest_client
                .get(format!("{}/auth/me", instance.server_url))
                .headers(common::central_ui_bff_with_user_principal_headers(&session))
                .send()
                .await
                .unwrap()
                .json()
                .await
                .unwrap();
            assert_eq!(before, after);
        }
    }
}

#[tokio::test]
async fn unknown_and_github_only_users_receive_no_reset_email_or_password() {
    use ethoko_central::{
        auth::requests::login_github_start::HttpLoginGithubStartResponse,
        clients::github::models::{GithubApiUserEmailsResponseItem, GithubApiUserResponse},
    };
    use fake::{Fake, Faker};
    let instance = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();
    let email = Faker.fake::<Email>();
    instance.github_client.set_next_user(GithubApiUserResponse {
        id: Faker.fake(),
        login: "github-user".into(),
    });
    instance
        .github_client
        .set_next_user_emails(vec![GithubApiUserEmailsResponseItem {
            email: email.to_string(),
            verified: true,
            primary: true,
        }]);
    let start: HttpLoginGithubStartResponse = instance
        .reqwest_client
        .post(format!("{}/auth/login/github/start", instance.server_url))
        .headers(central_ui_bff_principal_headers())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        post(
            &instance,
            "login/github/callback",
            json!({"code": instance.github_oauth_client.code().unwrap(), "state": start.state})
        )
        .await
        .status(),
        StatusCode::OK
    );
    for email in [email.to_string(), Faker.fake::<Email>().to_string()] {
        assert_eq!(
            post(&instance, "forgot-password", json!({"email": email}))
                .await
                .status(),
            StatusCode::OK
        );
        instance.job_worker.consume_jobs().await.unwrap();
        assert!(
            !instance
                .email_service
                .has_sent_email_to(&Email::new(&email).unwrap())
        );
        assert_eq!(
            post(
                &instance,
                "login/email",
                json!({"email": email, "password": "New-password1"})
            )
            .await
            .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    let response = instance
        .reqwest_client
        .post(format!("{}/auth/reset-password", instance.server_url))
        .json(&json!({"token": "a".repeat(64), "password": "New-password1"}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn recovery_requests_reject_empty_and_malformed_email() {
    let instance = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();
    for (email, reason) in [
        ("", "empty value not allowed"),
        ("not-an-email", "invalid format"),
    ] {
        let response = post(&instance, "forgot-password", json!({"email": email})).await;
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            response.json::<serde_json::Value>().await.unwrap(),
            json!({
                "code": "ETKAG01",
                "reason": format!("invalid submitted field \"email\": {reason}")
            })
        );
    }
}

#[tokio::test]
async fn recovery_requests_are_generic_and_require_only_machine_authentication() {
    let instance = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();
    let (user, _) = instance.signup_user().await;
    for email in [user.email.to_string(), "unknown@example.com".to_string()] {
        let response = instance
            .reqwest_client
            .post(format!("{}/auth/forgot-password", instance.server_url))
            .headers(central_ui_bff_principal_headers())
            .json(&json!({"email": email}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.json::<serde_json::Value>().await.unwrap(),
            json!({
                "message": "If this account is eligible for password recovery, you’ll receive an email.",
                "cooldownSeconds": 60
            })
        );
    }
    let response = instance
        .reqwest_client
        .post(format!("{}/auth/forgot-password", instance.server_url))
        .json(&json!({"email": user.email}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
