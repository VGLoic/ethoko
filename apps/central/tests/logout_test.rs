use axum::http::StatusCode;
mod common;
use common::{
    AuthActions, TestConfigBuilder, central_ui_bff_principal_headers,
    central_ui_bff_with_user_principal_headers, setup_instance,
};

#[tokio::test]
async fn test_logout_200() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let (user, password) = instance_state.signup_user().await;

    let token = instance_state.login_user(&user.email, &password).await;

    let logout_response = instance_state
        .reqwest_client
        .post(format!("{}/auth/logout", &instance_state.server_url))
        .headers(central_ui_bff_with_user_principal_headers(&token))
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
        .headers(central_ui_bff_principal_headers())
        .header("X-Ethoko-User-Authorization", "Bearer invalid_token")
        .send()
        .await
        .unwrap();

    assert_eq!(logout_response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_logout_401_without_bff_credential() {
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

    let token = instance_state.login_user(&user.email, &password).await;

    let logout_response = instance_state
        .reqwest_client
        .post(format!("{}/auth/logout", &instance_state.server_url))
        .headers(central_ui_bff_with_user_principal_headers(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(logout_response.status(), StatusCode::OK);

    let me_response = instance_state
        .reqwest_client
        .get(format!("{}/auth/me", &instance_state.server_url))
        .headers(central_ui_bff_with_user_principal_headers(&token))
        .send()
        .await
        .unwrap();

    assert_eq!(me_response.status(), StatusCode::UNAUTHORIZED);
}
