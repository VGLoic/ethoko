use axum::http::StatusCode;
use ethoko_central::{
    auth::{
        http_responses::UserResponse,
        requests::{
            login_email::{HttpLoginEmailBody, HttpLoginEmailResponse},
            register_handle::HttpRegisterHandleBody,
        },
    },
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
async fn test_register_handle_200_promotes_pending_user() {
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

    let response = instance_state
        .reqwest_client
        .post(format!("{}/auth/register-handle", &instance_state.server_url))
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
        .post(format!("{}/auth/register-handle", &instance_state.server_url))
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
        .post(format!("{}/auth/register-handle", &instance_state.server_url))
        .headers(central_ui_bff_with_user_principal_headers(&second_token))
        .json(&HttpRegisterHandleBody {
            handle: claimed_handle.to_string(),
        })
        .send()
        .await
        .unwrap();

    assert_eq!(duplicate_response.status(), StatusCode::UNPROCESSABLE_ENTITY);
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

    let token = instance_state.login_user(&signup_user.email, &password).await;

    let first_response = instance_state
        .reqwest_client
        .post(format!("{}/auth/register-handle", &instance_state.server_url))
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
        .post(format!("{}/auth/register-handle", &instance_state.server_url))
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
}

#[tokio::test]
async fn test_register_handle_422_invalid_handle() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let (signup_user, password) = instance_state.signup_user().await;
    let token = instance_state.login_user(&signup_user.email, &password).await;

    let response = instance_state
        .reqwest_client
        .post(format!("{}/auth/register-handle", &instance_state.server_url))
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
}

#[tokio::test]
async fn test_register_handle_401_without_bff_credential() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let response = instance_state
        .reqwest_client
        .post(format!("{}/auth/register-handle", &instance_state.server_url))
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
        .post(format!("{}/auth/register-handle", &instance_state.server_url))
        .headers(central_ui_bff_principal_headers())
        .json(&serde_json::json!({ "handle": "some-handle" }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_register_handle_pending_user_can_register_before_email_verification() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let (signup_user, password) = instance_state.signup_user().await;
    let token = instance_state.login_user(&signup_user.email, &password).await;
    let handle = Faker.fake::<Handle>();

    let response = instance_state
        .reqwest_client
        .post(format!("{}/auth/register-handle", &instance_state.server_url))
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
}
