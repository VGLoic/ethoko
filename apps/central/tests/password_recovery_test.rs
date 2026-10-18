use axum::http::StatusCode;
use common::{AuthActions, TestConfigBuilder, central_ui_bff_principal_headers, setup_instance};
use serde_json::json;
mod common;

#[tokio::test]
async fn recovery_accepts_password_users_without_a_session() {
    let config = TestConfigBuilder::new()
        .with_isolated_database()
        .await
        .build();
    let instance = setup_instance(&config).await.unwrap();
    let (user, _) = instance.signup_user().await;
    let response = instance
        .reqwest_client
        .post(format!("{}/auth/forgot-password", instance.server_url))
        .headers(central_ui_bff_principal_headers())
        .header("x-ethoko-client-ip", "192.0.2.1")
        .json(&json!({"email": user.email}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(
        body["message"],
        "If this account is eligible for password recovery, you’ll receive an email."
    );
    assert_eq!(body["cooldownSeconds"], 60);
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
        .header("x-ethoko-client-ip", "192.0.2.1")
        .json(&body)
        .send()
        .await
        .unwrap()
}

fn reset_links(
    instance: &common::InstanceState,
    email: &ethoko_central::newtypes::email::Email,
) -> Vec<String> {
    instance
        .email_service
        .get_emails_sent_to(email)
        .into_iter()
        .filter_map(|mail| match mail {
            ethoko_central::externalcom::email::EmailTemplate::PasswordReset {
                reset_url, ..
            } => Some(reset_url),
            _ => None,
        })
        .collect()
}

fn token(link: &str) -> String {
    reqwest::Url::parse(link)
        .unwrap()
        .query_pairs()
        .find(|(key, _)| key == "token")
        .unwrap()
        .1
        .into_owned()
}

#[tokio::test]
async fn recovery_limits_use_trusted_browser_ip_not_bff_ip_or_forwarded_headers() {
    let config = TestConfigBuilder::new()
        .with_auth_rate_limit(60, 1)
        .with_isolated_database()
        .await
        .build();
    let instance = setup_instance(&config).await.unwrap();
    let request = |ip: &'static str, forwarded: &'static str| {
        instance
            .reqwest_client
            .post(format!("{}/auth/forgot-password", instance.server_url))
            .headers(central_ui_bff_principal_headers())
            .header("x-ethoko-client-ip", ip)
            .header("x-forwarded-for", forwarded)
            .json(&json!({"email": "unknown@example.com"}))
    };
    assert_eq!(
        request("192.0.2.10", "198.51.100.1")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        request("192.0.2.11", "198.51.100.1")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        request("192.0.2.10", "198.51.100.2")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::TOO_MANY_REQUESTS
    );
}

#[tokio::test]
async fn recovery_round_trip_revokes_every_session_and_preserves_pending_unverified_state() {
    let config = TestConfigBuilder::new()
        .with_isolated_database()
        .await
        .build();
    let instance = setup_instance(&config).await.unwrap();
    let (user, old_password) = instance.signup_user().await;
    let sessions = [
        instance.login_user(&user.email, &old_password).await,
        instance.login_user(&user.email, &old_password).await,
    ];
    assert_eq!(
        post(&instance, "forgot-password", json!({"email": user.email}))
            .await
            .status(),
        StatusCode::OK
    );
    assert!(
        reset_links(&instance, &user.email).is_empty(),
        "delivery is asynchronous"
    );
    instance.recovery_job_worker.consume_jobs().await.unwrap();
    let links = reset_links(&instance, &user.email);
    assert_eq!(links.len(), 1);
    assert!(links[0].starts_with("http://localhost:5173/reset-password?token="));
    let reset_token = token(&links[0]);
    for _ in 0..2 {
        assert_eq!(
            post(
                &instance,
                "reset-password/validate",
                json!({"token": reset_token})
            )
            .await
            .status(),
            StatusCode::OK
        );
    }
    let response = post(
        &instance,
        "reset-password",
        json!({"token": reset_token, "password": "NewPassword42!"}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    for session in sessions {
        let response = instance
            .reqwest_client
            .get(format!("{}/auth/me", instance.server_url))
            .headers(common::central_ui_bff_with_user_principal_headers(&session))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
    assert_eq!(
        post(
            &instance,
            "login/email",
            json!({"email": user.email, "password": old_password.as_str()})
        )
        .await
        .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let password = ethoko_central::newtypes::password::Password::new("NewPassword42!").unwrap();
    let session = instance.login_user(&user.email, &password).await;
    let me: serde_json::Value = instance
        .reqwest_client
        .get(format!("{}/auth/me", instance.server_url))
        .headers(common::central_ui_bff_with_user_principal_headers(&session))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(me["state"], "pending");
    assert_eq!(me["email_verified"], false);
}

#[tokio::test]
async fn cooldown_is_normalized_shared_and_does_not_supersede_the_current_link() {
    let config = TestConfigBuilder::new()
        .with_recovery_cooldown(2)
        .with_isolated_database()
        .await
        .build();
    let first = setup_instance(&config).await.unwrap();
    let second = setup_instance(&config).await.unwrap();
    let (user, _) = first.signup_user().await;
    let response = post(&first, "forgot-password", json!({"email": user.email})).await;
    let expected: serde_json::Value = response.json().await.unwrap();
    assert_eq!(expected["cooldownSeconds"], 2);
    let alternate_email = format!("  {}  ", user.email.to_string().to_uppercase());
    let (a, b) = tokio::join!(
        post(&first, "forgot-password", json!({"email": alternate_email})),
        post(
            &second,
            "forgot-password",
            json!({"email": alternate_email})
        ),
    );
    for response in [a, b] {
        assert_eq!(
            response.json::<serde_json::Value>().await.unwrap(),
            expected
        );
    }
    first.recovery_job_worker.consume_jobs().await.unwrap();
    let links = reset_links(&first, &user.email);
    assert_eq!(links.len(), 1);
    assert_eq!(
        post(
            &second,
            "reset-password/validate",
            json!({"token": token(&links[0])})
        )
        .await
        .status(),
        StatusCode::OK
    );
    tokio::time::sleep(std::time::Duration::from_millis(2100)).await;
    assert_eq!(
        post(
            &second,
            "forgot-password",
            json!({"email": alternate_email})
        )
        .await
        .status(),
        StatusCode::OK
    );
    first.recovery_job_worker.consume_jobs().await.unwrap();
    let links = reset_links(&first, &user.email);
    assert_eq!(links.len(), 2);
    assert_ne!(links[0], links[1]);
    let invalid = post(
        &first,
        "reset-password",
        json!({"token": token(&links[0]), "password": "NewPassword42!"}),
    )
    .await;
    assert_eq!(invalid.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        post(
            &second,
            "reset-password",
            json!({"token": token(&links[1]), "password": "NewPassword42!"})
        )
        .await
        .status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn validation_errors_preserve_the_link_and_concurrent_submissions_have_one_winner() {
    let config = TestConfigBuilder::new()
        .with_isolated_database()
        .await
        .build();
    let instance = setup_instance(&config).await.unwrap();
    let (user, _) = instance.signup_user().await;
    post(&instance, "forgot-password", json!({"email": user.email})).await;
    instance.recovery_job_worker.consume_jobs().await.unwrap();
    let reset_token = token(&reset_links(&instance, &user.email)[0]);
    for password in [
        "short",
        "ALLUPPER123!",
        "alllower123!",
        "NoDigitsHere!",
        "NoSpecial123",
        "        ",
    ] {
        let response = post(
            &instance,
            "reset-password",
            json!({"token": reset_token, "password": password}),
        )
        .await;
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            response.json::<serde_json::Value>().await.unwrap()["code"],
            "ETKAG01"
        );
    }
    let session_response = instance
        .reqwest_client
        .get(format!("{}/auth/me", instance.server_url))
        .headers(common::central_ui_bff_with_user_principal_headers(
            &reset_token,
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(session_response.status(), StatusCode::UNAUTHORIZED);
    let body = json!({"token": reset_token, "password": "  Aa1ééé  "});
    let (a, b) = tokio::join!(
        post(&instance, "reset-password", body.clone()),
        post(&instance, "reset-password", body.clone())
    );
    let mut statuses = [a.status().as_u16(), b.status().as_u16()];
    statuses.sort();
    assert_eq!(statuses, [200, 422]);
    let used = post(&instance, "reset-password", body).await;
    let unknown = post(
        &instance,
        "reset-password",
        json!({"token": "unknown", "password": "NewPassword42!"}),
    )
    .await;
    assert_eq!(used.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        used.json::<serde_json::Value>().await.unwrap(),
        unknown.json::<serde_json::Value>().await.unwrap()
    );
    instance
        .login_user(
            &user.email,
            &ethoko_central::newtypes::password::Password::new("Aa1ééé").unwrap(),
        )
        .await;
}

#[tokio::test]
async fn recovery_requires_machine_authentication_and_valid_request_shapes() {
    let config = TestConfigBuilder::new()
        .with_isolated_database()
        .await
        .build();
    let instance = setup_instance(&config).await.unwrap();
    for (path, body) in [
        ("forgot-password", json!({"email": "user@example.com"})),
        (
            "reset-password",
            json!({"token": "unknown", "password": "NewPassword42!"}),
        ),
        ("reset-password/validate", json!({"token": "unknown"})),
    ] {
        for authorization in [None, Some("Bearer wrong-machine-credential")] {
            let mut request = instance
                .reqwest_client
                .post(format!("{}/auth/{path}", instance.server_url))
                .json(&body);
            if let Some(value) = authorization {
                request = request.header("authorization", value);
            }
            assert_eq!(
                request.send().await.unwrap().status(),
                StatusCode::UNAUTHORIZED
            );
        }
    }
    assert_eq!(
        post(&instance, "forgot-password", json!({"email": "invalid"}))
            .await
            .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
}

async fn github_login(
    instance: &common::InstanceState,
    email: &ethoko_central::newtypes::email::Email,
) -> String {
    use ethoko_central::clients::github::models::{
        GithubApiUserEmailsResponseItem, GithubApiUserResponse,
    };
    instance.github_client.set_next_user(GithubApiUserResponse {
        id: 137,
        login: "github-only".into(),
    });
    instance
        .github_client
        .set_next_user_emails(vec![GithubApiUserEmailsResponseItem {
            email: email.to_string(),
            verified: true,
            primary: true,
        }]);
    let start: serde_json::Value = post(instance, "login/github/start", json!({}))
        .await
        .json()
        .await
        .unwrap();
    let response = post(
        instance,
        "login/github/callback",
        json!({"code": instance.github_oauth_client.code().unwrap(), "state": start["state"]}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    response.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string()
}

#[tokio::test]
async fn unknown_and_github_only_users_are_indistinguishable_and_never_gain_passwords() {
    use ethoko_central::newtypes::email::Email;
    let config = TestConfigBuilder::new()
        .with_isolated_database()
        .await
        .build();
    let instance = setup_instance(&config).await.unwrap();
    let github_email = Email::new("github-only@example.com").unwrap();
    github_login(&instance, &github_email).await;
    let (eligible, _) = instance.signup_user().await;
    let expected: serde_json::Value = post(
        &instance,
        "forgot-password",
        json!({"email": eligible.email}),
    )
    .await
    .json()
    .await
    .unwrap();
    for email in ["unknown@example.com", github_email.as_str()] {
        let response = post(&instance, "forgot-password", json!({"email": email})).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.json::<serde_json::Value>().await.unwrap(),
            expected
        );
    }
    instance.recovery_job_worker.consume_jobs().await.unwrap();
    assert!(reset_links(&instance, &github_email).is_empty());
    assert!(reset_links(&instance, &Email::new("unknown@example.com").unwrap()).is_empty());
    assert_eq!(reset_links(&instance, &eligible.email).len(), 1);
    assert_eq!(
        post(
            &instance,
            "login/email",
            json!({"email": github_email, "password": "NewPassword42!"})
        )
        .await
        .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    // Its existing authentication method remains usable and is not silently replaced.
    github_login(&instance, &github_email).await;
}

fn verification_otp(
    instance: &common::InstanceState,
    email: &ethoko_central::newtypes::email::Email,
) -> String {
    instance
        .email_service
        .get_emails_sent_to(email)
        .into_iter()
        .find_map(|mail| match mail {
            ethoko_central::externalcom::email::EmailTemplate::EmailVerificationCode(payload) => {
                Some(payload.otp.show().to_string())
            }
            _ => None,
        })
        .unwrap()
}

#[tokio::test]
async fn recovery_preserves_onboarding_and_verification_and_leaves_verification_codes_usable() {
    let config = TestConfigBuilder::new()
        .with_isolated_database()
        .await
        .build();
    let instance = setup_instance(&config).await.unwrap();
    for registered in [false, true] {
        for verified in [false, true] {
            let (user, password) = instance.signup_user().await;
            let session = instance.login_user(&user.email, &password).await;
            let otp = verification_otp(&instance, &user.email);
            if verified {
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
            let handle = format!("user-{}", uuid::Uuid::new_v4().simple())
                .chars()
                .take(30)
                .collect::<String>();
            if registered {
                let response = instance
                    .reqwest_client
                    .post(format!("{}/auth/register-handle", instance.server_url))
                    .headers(common::central_ui_bff_with_user_principal_headers(&session))
                    .json(&json!({"handle": handle}))
                    .send()
                    .await
                    .unwrap();
                assert_eq!(response.status(), StatusCode::OK);
            }
            let response = post(&instance, "forgot-password", json!({"email": user.email})).await;
            assert_eq!(
                response.status(),
                StatusCode::OK,
                "{}",
                response.text().await.unwrap()
            );
            instance.recovery_job_worker.consume_jobs().await.unwrap();
            let reset_token = token(&reset_links(&instance, &user.email)[0]);
            assert_eq!(
                post(
                    &instance,
                    "reset-password",
                    json!({"token": reset_token, "password": "NewPassword42!"})
                )
                .await
                .status(),
                StatusCode::OK
            );
            let session = instance
                .login_user(
                    &user.email,
                    &ethoko_central::newtypes::password::Password::new("NewPassword42!").unwrap(),
                )
                .await;
            let me: serde_json::Value = instance
                .reqwest_client
                .get(format!("{}/auth/me", instance.server_url))
                .headers(common::central_ui_bff_with_user_principal_headers(&session))
                .send()
                .await
                .unwrap()
                .json()
                .await
                .unwrap();
            assert_eq!(
                me["state"],
                if registered { "registered" } else { "pending" }
            );
            assert_eq!(me["email_verified"], verified);
            if registered {
                assert_eq!(me["handle"], handle);
            }
            if !verified {
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
        }
    }
}

fn reset_deliveries(
    messages: Vec<ethoko_central::externalcom::email::EmailTemplate>,
) -> Vec<(String, chrono::DateTime<chrono::Utc>)> {
    messages
        .into_iter()
        .filter_map(|mail| match mail {
            ethoko_central::externalcom::email::EmailTemplate::PasswordReset {
                reset_url,
                expires_at,
            } => Some((reset_url, expires_at)),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn delivery_retries_preserve_original_link_and_expiry_even_after_expiration() {
    let config = TestConfigBuilder::new()
        .with_recovery_ttl(1)
        .with_isolated_database()
        .await
        .build();
    let instance = setup_instance(&config).await.unwrap();
    let (user, _) = instance.signup_user().await;
    post(&instance, "forgot-password", json!({"email": user.email})).await;
    instance.email_service.fail_next_emails(1);
    instance.recovery_job_worker.consume_jobs().await.unwrap();
    let attempts = reset_deliveries(instance.email_service.get_attempts_to(&user.email));
    assert_eq!(attempts.len(), 1);
    assert!(reset_links(&instance, &user.email).is_empty());
    tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
    instance.recovery_job_worker.consume_jobs().await.unwrap();
    let sent = reset_deliveries(instance.email_service.get_emails_sent_to(&user.email));
    assert_eq!(sent, attempts);
    let expired_token = token(&sent[0].0);
    for path in ["reset-password", "reset-password/validate"] {
        let response = post(
            &instance,
            path,
            json!({"token": expired_token, "password": "NewPassword42!"}),
        )
        .await;
        let unknown = post(
            &instance,
            path,
            json!({"token": "unknown", "password": "NewPassword42!"}),
        )
        .await;
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            response.json::<serde_json::Value>().await.unwrap(),
            unknown.json::<serde_json::Value>().await.unwrap()
        );
    }
}

#[tokio::test]
async fn retrying_an_older_delivery_cannot_replace_a_newer_issued_link() {
    let config = TestConfigBuilder::new()
        .with_recovery_cooldown(0)
        .with_isolated_database()
        .await
        .build();
    let instance = setup_instance(&config).await.unwrap();
    let (user, _) = instance.signup_user().await;
    post(&instance, "forgot-password", json!({"email": user.email})).await;
    instance.email_service.fail_next_emails(1);
    instance.recovery_job_worker.consume_jobs().await.unwrap();
    let original = reset_deliveries(instance.email_service.get_attempts_to(&user.email))[0].clone();
    // A token is already valid before any successful delivery.
    assert_eq!(
        post(
            &instance,
            "reset-password/validate",
            json!({"token": token(&original.0)})
        )
        .await
        .status(),
        StatusCode::OK
    );
    post(&instance, "forgot-password", json!({"email": user.email})).await;
    instance.recovery_job_worker.consume_jobs().await.unwrap();
    let current =
        reset_deliveries(instance.email_service.get_emails_sent_to(&user.email))[0].clone();
    assert_ne!(current.0, original.0);
    tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
    instance.recovery_job_worker.consume_jobs().await.unwrap();
    let attempts = reset_deliveries(instance.email_service.get_attempts_to(&user.email));
    assert_eq!(
        attempts
            .iter()
            .filter(|delivery| **delivery == original)
            .count(),
        2
    );
    assert_eq!(
        post(
            &instance,
            "reset-password",
            json!({"token": token(&original.0), "password": "NewPassword42!"})
        )
        .await
        .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        post(
            &instance,
            "reset-password",
            json!({"token": token(&current.0), "password": "NewPassword42!"})
        )
        .await
        .status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn concurrent_first_issuance_across_instances_emits_one_link() {
    let config = TestConfigBuilder::new()
        .with_isolated_database()
        .await
        .build();
    let first = setup_instance(&config).await.unwrap();
    let second = setup_instance(&config).await.unwrap();
    let (user, _) = first.signup_user().await;
    let body = json!({"email": user.email});
    let (a, b) = tokio::join!(
        post(&first, "forgot-password", body.clone()),
        post(&second, "forgot-password", body)
    );
    assert_eq!(a.status(), StatusCode::OK);
    assert_eq!(b.status(), StatusCode::OK);
    first.recovery_job_worker.consume_jobs().await.unwrap();
    assert_eq!(reset_links(&first, &user.email).len(), 1);
}

// Database fault injection is fixture setup only. Assertions stay at the HTTP and
// delivery seams: no test inspects token storage, credentials, sessions or queue rows.
async fn storage_fault(
    config: &ethoko_central::config::Config,
    table: &str,
    event: &str,
    enable: bool,
) {
    let pool = sqlx::PgPool::connect(&config.database_url).await.unwrap();
    if enable {
        sqlx::raw_sql(&format!("CREATE OR REPLACE FUNCTION recovery_storage_failure() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'simulated storage failure'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER recovery_storage_failure BEFORE {event} ON {table} FOR EACH ROW EXECUTE FUNCTION recovery_storage_failure();"))
            .execute(&pool).await.unwrap();
    } else {
        sqlx::query(&format!("DROP TRIGGER recovery_storage_failure ON {table}"))
            .execute(&pool)
            .await
            .unwrap();
    }
    pool.close().await;
}

#[tokio::test]
async fn issuance_and_completion_roll_back_every_change_on_storage_failure() {
    let config = TestConfigBuilder::new()
        .with_isolated_database()
        .await
        .build();
    let instance = setup_instance(&config).await.unwrap();
    let (user, password) = instance.signup_user().await;
    let session = instance.login_user(&user.email, &password).await;
    storage_fault(&config, "ethoko_job", "INSERT", true).await;
    assert_eq!(
        post(&instance, "forgot-password", json!({"email": user.email}))
            .await
            .status(),
        StatusCode::INTERNAL_SERVER_ERROR
    );
    storage_fault(&config, "ethoko_job", "INSERT", false).await;
    instance.recovery_job_worker.consume_jobs().await.unwrap();
    assert!(reset_links(&instance, &user.email).is_empty());
    assert_eq!(
        post(&instance, "forgot-password", json!({"email": user.email}))
            .await
            .status(),
        StatusCode::OK
    );
    instance.recovery_job_worker.consume_jobs().await.unwrap();
    let reset_token = token(&reset_links(&instance, &user.email)[0]);
    storage_fault(&config, "opaque_token", "UPDATE", true).await;
    assert_eq!(
        post(
            &instance,
            "reset-password",
            json!({"token": reset_token, "password": "NewPassword42!"})
        )
        .await
        .status(),
        StatusCode::INTERNAL_SERVER_ERROR
    );
    storage_fault(&config, "opaque_token", "UPDATE", false).await;
    // A failed completion changed neither password nor sessions nor link validity.
    assert_eq!(
        post(
            &instance,
            "login/email",
            json!({"email": user.email, "password": "NewPassword42!"})
        )
        .await
        .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    instance.login_user(&user.email, &password).await;
    let me = instance
        .reqwest_client
        .get(format!("{}/auth/me", instance.server_url))
        .headers(common::central_ui_bff_with_user_principal_headers(&session))
        .send()
        .await
        .unwrap();
    assert_eq!(me.status(), StatusCode::OK);
    assert_eq!(
        post(
            &instance,
            "reset-password/validate",
            json!({"token": reset_token})
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        post(
            &instance,
            "reset-password",
            json!({"token": reset_token, "password": "NewPassword42!"})
        )
        .await
        .status(),
        StatusCode::OK
    );
    let me = instance
        .reqwest_client
        .get(format!("{}/auth/me", instance.server_url))
        .headers(common::central_ui_bff_with_user_principal_headers(&session))
        .send()
        .await
        .unwrap();
    assert_eq!(me.status(), StatusCode::UNAUTHORIZED);
}
