use axum::http::StatusCode;
use ethoko_central::{
    auth::{
        http_responses::UserResponse,
        requests::{
            login_email::{HttpLoginEmailBody, HttpLoginEmailResponse},
            login_github_callback::{HttpLoginGithubCallbackBody, HttpLoginGithubCallbackResponse},
            login_github_start::HttpLoginGithubStartResponse,
            register_handle::HttpRegisterHandleBody,
        },
    },
    clients::github::models::{GithubApiUserEmailsResponseItem, GithubApiUserResponse},
    externalcom::email::EmailTemplate,
    newtypes::email::Email,
    newtypes::handle::Handle,
    router::UnprocessableEntityError,
};
mod common;
use common::{
    AuthActions, TestConfigBuilder, central_ui_bff_principal_headers,
    central_ui_bff_with_user_principal_headers, setup_instance,
};
use fake::{Fake, Faker};

#[tokio::test]
async fn test_register_handle_200_adds_registration_to_user() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let (signup_user, password) = instance_state.signup_user().await;
    let handle = Faker.fake::<Handle>();

    let token = instance_state
        .reqwest_client
        .post(format!("{}/auth/login/email", &instance_state.server_url))
        .headers(central_ui_bff_principal_headers())
        .json(&HttpLoginEmailBody {
            email: signup_user.email.to_string(),
            password: password.as_str().to_string(),
        })
        .send()
        .await
        .unwrap()
        .json::<HttpLoginEmailResponse>()
        .await
        .unwrap()
        .token;

    let before = instance_state
        .reqwest_client
        .get(format!("{}/auth/me", &instance_state.server_url))
        .headers(central_ui_bff_with_user_principal_headers(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(before.status(), StatusCode::OK);
    let before: serde_json::Value = before.json().await.unwrap();
    assert_eq!(before["state"], "pending");
    assert_eq!(
        before.get("handle_registration"),
        Some(&serde_json::Value::Null)
    );

    let response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/register-handle",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_with_user_principal_headers(&token))
        .json(&HttpRegisterHandleBody {
            handle: handle.to_string(),
        })
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(
        body["handle_registration"],
        serde_json::json!({ "handle": handle.to_string() })
    );
    assert_eq!(body["createdAt"], before["createdAt"]);
    assert_eq!(get_me(&instance_state, &token).await, body);
    let fresh_token = instance_state
        .login_user(&signup_user.email, &password)
        .await;
    assert_eq!(get_me(&instance_state, &fresh_token).await, body);
    let user: UserResponse = serde_json::from_value(body).unwrap();
    match user {
        UserResponse::Registered {
            email,
            handle: registered_handle,
            email_verified,
            ..
        } => {
            assert_eq!(email, signup_user.email);
            assert_eq!(registered_handle, handle);
            assert!(!email_verified);
        }
        UserResponse::Pending { .. } => panic!("expected registered user response"),
    }
}

#[tokio::test]
async fn test_register_handle_422_duplicate_handle_keeps_other_user_pending_retryable() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let (first_signup_user, first_password) = instance_state.signup_user().await;
    let (second_signup_user, second_password) = instance_state.signup_user().await;
    let claimed_handle = Faker.fake::<Handle>();

    let first_token = instance_state
        .login_user(&first_signup_user.email, &first_password)
        .await;
    let second_token = instance_state
        .login_user(&second_signup_user.email, &second_password)
        .await;

    let first_register_response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/register-handle",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_with_user_principal_headers(&first_token))
        .json(&HttpRegisterHandleBody {
            handle: claimed_handle.to_string(),
        })
        .send()
        .await
        .unwrap();
    assert_eq!(first_register_response.status(), StatusCode::OK);

    let duplicate_response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/register-handle",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_with_user_principal_headers(&second_token))
        .json(&HttpRegisterHandleBody {
            handle: claimed_handle.to_string(),
        })
        .send()
        .await
        .unwrap();

    assert_eq!(
        duplicate_response.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let error = duplicate_response
        .json::<UnprocessableEntityError>()
        .await
        .unwrap();
    assert_eq!(error.code, "ETKARH01");

    let me_response = instance_state
        .reqwest_client
        .get(format!("{}/auth/me", &instance_state.server_url))
        .headers(central_ui_bff_with_user_principal_headers(&second_token))
        .send()
        .await
        .unwrap();

    assert_eq!(me_response.status(), StatusCode::OK);
    let user: UserResponse = me_response.json().await.unwrap();
    match user {
        UserResponse::Pending { email, .. } => assert_eq!(email, second_signup_user.email),
        UserResponse::Registered { .. } => panic!("expected duplicate claimant to remain pending"),
    }
}

#[tokio::test]
async fn test_register_handle_422_already_registered_user_cannot_change_handle() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let (signup_user, password) = instance_state.signup_user().await;
    let first_handle = Faker.fake::<Handle>();
    let second_handle = Faker.fake::<Handle>();

    let token = instance_state
        .login_user(&signup_user.email, &password)
        .await;

    let first_response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/register-handle",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_with_user_principal_headers(&token))
        .json(&HttpRegisterHandleBody {
            handle: first_handle.to_string(),
        })
        .send()
        .await
        .unwrap();
    assert_eq!(first_response.status(), StatusCode::OK);

    let second_response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/register-handle",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_with_user_principal_headers(&token))
        .json(&HttpRegisterHandleBody {
            handle: second_handle.to_string(),
        })
        .send()
        .await
        .unwrap();

    assert_eq!(second_response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = second_response
        .json::<UnprocessableEntityError>()
        .await
        .unwrap();
    assert_eq!(error.code, "ETKARH02");
    let user = get_me(&instance_state, &token).await;
    assert_eq!(
        user["handle_registration"]["handle"],
        first_handle.to_string()
    );
    assert_eq!(user["handle"], first_handle.to_string());
    let repeat = register_handle(&instance_state, &token, &first_handle.to_string()).await;
    assert_eq!(repeat.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        repeat
            .json::<UnprocessableEntityError>()
            .await
            .unwrap()
            .code,
        "ETKARH02"
    );
    assert_eq!(get_me(&instance_state, &token).await, user);
}

#[tokio::test]
async fn test_register_handle_422_invalid_handle() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let (signup_user, password) = instance_state.signup_user().await;
    let token = instance_state
        .login_user(&signup_user.email, &password)
        .await;

    let response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/register-handle",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_with_user_principal_headers(&token))
        .json(&HttpRegisterHandleBody {
            handle: "bad handle".to_string(),
        })
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = response.json::<UnprocessableEntityError>().await.unwrap();
    assert_eq!(error.code, "ETKAG01");
    assert_eq!(
        get_me(&instance_state, &token).await["handle_registration"],
        serde_json::Value::Null
    );
    assert_eq!(
        register_handle(&instance_state, &token, &Faker.fake::<Handle>().to_string())
            .await
            .status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn test_register_handle_401_without_bff_credential() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/register-handle",
            &instance_state.server_url
        ))
        .json(&serde_json::json!({ "handle": "some-handle" }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_register_handle_401_without_user_session_header() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/register-handle",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .json(&serde_json::json!({ "handle": "some-handle" }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_register_handle_user_can_register_before_email_verification() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let (signup_user, password) = instance_state.signup_user().await;
    let token = instance_state
        .login_user(&signup_user.email, &password)
        .await;
    let handle = Faker.fake::<Handle>();

    let response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/register-handle",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_with_user_principal_headers(&token))
        .json(&HttpRegisterHandleBody {
            handle: handle.to_string(),
        })
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let user: UserResponse = response.json().await.unwrap();
    match user {
        UserResponse::Registered { email_verified, .. } => assert!(!email_verified),
        UserResponse::Pending { .. } => panic!("expected registered user response"),
    }

    let emails = instance_state
        .email_service
        .get_emails_sent_to(&signup_user.email);
    let otp = match emails.first().expect("signup sends a verification email") {
        EmailTemplate::EmailVerificationCode(payload) => payload.otp.show().to_string(),
    };
    let verified = instance_state
        .reqwest_client
        .post(format!("{}/auth/verify-email", instance_state.server_url))
        .headers(central_ui_bff_principal_headers())
        .json(&serde_json::json!({ "email": signup_user.email.to_string(), "otp": otp }))
        .send()
        .await
        .unwrap();
    assert_eq!(verified.status(), StatusCode::OK);
    let verified: serde_json::Value = verified.json().await.unwrap();
    assert_eq!(
        verified["handle_registration"]["handle"],
        handle.to_string()
    );
    assert_eq!(verified["emailVerified"], true);
    assert_eq!(get_me(&instance_state, &token).await, verified);
}

#[tokio::test]
async fn test_register_handle_github_suggestion_is_non_reserving_and_cleared_on_registration() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let email = Faker.fake::<Email>();
    let github_user = GithubApiUserResponse {
        id: Faker.fake::<u64>(),
        login: Faker.fake::<Handle>().to_string(),
    };
    let suggested_handle = github_user.login.clone();
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

    let token = instance_state
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
        .unwrap()
        .token;

    let before = get_me(&instance_state, &token).await;
    assert_eq!(before["suggestedHandle"], suggested_handle);
    assert_eq!(
        before.get("handle_registration"),
        Some(&serde_json::Value::Null)
    );

    // A suggestion does not reserve a Namespace for the provider's User.
    let (other_user, password) = instance_state.signup_user().await;
    let other_token = instance_state
        .login_user(&other_user.email, &password)
        .await;
    assert_eq!(
        register_handle(&instance_state, &other_token, &suggested_handle)
            .await
            .status(),
        StatusCode::OK
    );
    let failed_claim = register_handle(&instance_state, &token, &suggested_handle).await;
    assert_eq!(failed_claim.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        failed_claim
            .json::<UnprocessableEntityError>()
            .await
            .unwrap()
            .code,
        "ETKARH01"
    );
    assert_eq!(get_me(&instance_state, &token).await, before);

    let handle = Faker.fake::<Handle>();

    let response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/register-handle",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_with_user_principal_headers(&token))
        .json(&HttpRegisterHandleBody {
            handle: handle.to_string(),
        })
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let user: serde_json::Value = response.json().await.unwrap();
    assert_eq!(user["email"], email.to_string());
    assert_eq!(user["handle_registration"]["handle"], handle.to_string());
    assert_eq!(user["emailVerified"], false);
    assert!(user.get("suggestedHandle").is_none());
    assert_eq!(get_me(&instance_state, &token).await, user);
}

#[tokio::test]
async fn test_competing_users_claim_one_handle_without_partial_registration() {
    let instance = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();
    let (first, first_password) = instance.signup_user().await;
    let (second, second_password) = instance.signup_user().await;
    let first_token = instance.login_user(&first.email, &first_password).await;
    let second_token = instance.login_user(&second.email, &second_password).await;
    let handle = Faker.fake::<Handle>().to_string();

    let (first_response, second_response) = tokio::join!(
        register_handle(&instance, &first_token, &handle),
        register_handle(&instance, &second_token, &handle),
    );
    let (winner_token, loser_token, loser_response) = if first_response.status() == StatusCode::OK {
        (&first_token, &second_token, second_response)
    } else {
        assert_eq!(second_response.status(), StatusCode::OK);
        (&second_token, &first_token, first_response)
    };
    assert_eq!(loser_response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        loser_response
            .json::<UnprocessableEntityError>()
            .await
            .unwrap()
            .code,
        "ETKARH01"
    );
    assert_eq!(
        get_me(&instance, winner_token).await["handle_registration"]["handle"],
        handle
    );
    let loser = get_me(&instance, loser_token).await;
    assert_eq!(loser["state"], "pending");
    assert_eq!(
        loser.get("handle_registration"),
        Some(&serde_json::Value::Null)
    );

    let retry_handle = Faker.fake::<Handle>().to_string();
    let retry = register_handle(&instance, loser_token, &retry_handle).await;
    assert_eq!(retry.status(), StatusCode::OK);
    assert_eq!(
        get_me(&instance, loser_token).await["handle_registration"]["handle"],
        retry_handle
    );
}

#[tokio::test]
async fn test_competing_registrations_by_one_user_keep_the_first_handle_permanent() {
    let instance = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();
    let (user, password) = instance.signup_user().await;
    // Independent sessions avoid session-token row locking serializing the requests.
    let first_token = instance.login_user(&user.email, &password).await;
    let second_token = instance.login_user(&user.email, &password).await;
    let first_handle = Faker.fake::<Handle>().to_string();
    let second_handle = Faker.fake::<Handle>().to_string();
    let (first, second) = tokio::join!(
        register_handle(&instance, &first_token, &first_handle),
        register_handle(&instance, &second_token, &second_handle),
    );
    let (winner, rejected, rejected_handle) = if first.status() == StatusCode::OK {
        (first, second, second_handle)
    } else {
        assert_eq!(second.status(), StatusCode::OK);
        (second, first, first_handle)
    };
    assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        rejected
            .json::<UnprocessableEntityError>()
            .await
            .unwrap()
            .code,
        "ETKARH02"
    );
    let winner: serde_json::Value = winner.json().await.unwrap();
    assert_eq!(get_me(&instance, &first_token).await, winner);
    assert_eq!(get_me(&instance, &second_token).await, winner);

    // The rejected handle was not partially claimed.
    let (other, password) = instance.signup_user().await;
    let other_token = instance.login_user(&other.email, &password).await;
    assert_eq!(
        register_handle(&instance, &other_token, &rejected_handle)
            .await
            .status(),
        StatusCode::OK
    );
}

async fn register_handle(
    instance: &common::InstanceState,
    token: &str,
    handle: &str,
) -> reqwest::Response {
    instance
        .reqwest_client
        .post(format!("{}/auth/register-handle", instance.server_url))
        .headers(central_ui_bff_with_user_principal_headers(token))
        .json(&HttpRegisterHandleBody {
            handle: handle.to_string(),
        })
        .send()
        .await
        .unwrap()
}

async fn get_me(instance: &common::InstanceState, token: &str) -> serde_json::Value {
    let response = instance
        .reqwest_client
        .get(format!("{}/auth/me", instance.server_url))
        .headers(central_ui_bff_with_user_principal_headers(token))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    response.json().await.unwrap()
}
