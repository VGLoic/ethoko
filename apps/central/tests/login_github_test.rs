use axum::http::StatusCode;
use ethoko_central::{
    auth::requests::{
        login_github_callback::HttpLoginGithubCallbackBody,
        login_github_start::HttpLoginGithubStartResponse,
    },
    router::UnprocessableEntityError,
};
mod common;
use common::{TestConfigBuilder, central_ui_bff_principal_headers, setup_instance};

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
            .with_github_oauth_transaction_ttl_seconds(1)
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
            state: start_response.csrf_token,
        })
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = response.json::<UnprocessableEntityError>().await.unwrap();
    assert_eq!(error.code, "ETKLGC03");
}
