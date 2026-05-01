use axum::http::StatusCode;
use ethoko_central::routes::GetHealthcheckResponse;
mod common;
use common::{setup_instance, default_test_config};

#[tokio::test]
async fn test_healthcheck() {
    let instance_state = setup_instance(&default_test_config()).await.unwrap();

    let response = reqwest::get(format!("{}/health", &instance_state.server_url))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.json::<GetHealthcheckResponse>().await.unwrap().ok);
}
