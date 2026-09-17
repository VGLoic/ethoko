use axum::http::StatusCode;
use ethoko_central::auth::{requests::login_email::LoginEmailBody, users_response};
mod common;
use common::{TestConfigBuilder, setup_instance};

#[tokio::test]
async fn test_logout_200() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let (user, password) = instance_state.signup_user().await;

    let token = instance_state
        .reqwest_client
        .post(format!("{}/auth/login", &instance_state.server_url))
        .json(&LoginEmailBody {
            email: user.email.to_string(),
            password: password.as_str().to_string(),
        })
        .send()
        .await
        .unwrap()
        .json::<users_response::LoginResponse>()
        .await
        .unwrap()
        .token;

    let logout_response = instance_state
        .reqwest_client
        .post(format!("{}/auth/logout", &instance_state.server_url))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();

    assert_eq!(logout_response.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_logout_401_unauthorized() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let logout_response = instance_state
        .reqwest_client
        .post(format!("{}/auth/logout", &instance_state.server_url))
        .bearer_auth("invalid_token")
        .send()
        .await
        .unwrap();

    assert_eq!(logout_response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_logout_revoke_token() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let (user, password) = instance_state.signup_user().await;

    let token = instance_state
        .reqwest_client
        .post(format!("{}/auth/login", &instance_state.server_url))
        .json(&LoginEmailBody {
            email: user.email.to_string(),
            password: password.as_str().to_string(),
        })
        .send()
        .await
        .unwrap()
        .json::<users_response::LoginResponse>()
        .await
        .unwrap()
        .token;

    let logout_response = instance_state
        .reqwest_client
        .post(format!("{}/auth/logout", &instance_state.server_url))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();

    assert_eq!(logout_response.status(), StatusCode::OK);

    let me_response = instance_state
        .reqwest_client
        .get(format!("{}/auth/me", &instance_state.server_url))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();

    assert_eq!(me_response.status(), StatusCode::UNAUTHORIZED);
}
