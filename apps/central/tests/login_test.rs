use axum::http::StatusCode;
use ethoko_central::{
    auth::{requests::login_email::LoginEmailBody, users_response},
    newtypes::password::Password,
};
mod common;
use common::{TestConfigBuilder, setup_instance};
use fake::{Fake, Faker};

#[tokio::test]
async fn test_login_200() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let (user, password) = instance_state.signup_user().await;

    let login_body = LoginEmailBody {
        email: user.email.to_string(),
        password: password.as_str().to_string(),
    };

    let login_response = instance_state
        .reqwest_client
        .post(format!("{}/auth/login", &instance_state.server_url))
        .json(&login_body)
        .send()
        .await
        .unwrap();

    assert_eq!(login_response.status(), StatusCode::OK);
    let response_body: users_response::LoginResponse = login_response.json().await.unwrap();
    assert!(response_body.token.starts_with("etks_"));
}

#[tokio::test]
async fn test_login_token_valid() {
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

    let me_response = instance_state
        .reqwest_client
        .get(format!("{}/auth/me", &instance_state.server_url))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();

    assert_eq!(me_response.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_login_400_invalid_email() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let login_body = LoginEmailBody {
        email: "invalid_email".to_string(),
        password: "password".to_string(),
    };

    let login_response = instance_state
        .reqwest_client
        .post(format!("{}/auth/login", &instance_state.server_url))
        .json(&login_body)
        .send()
        .await
        .unwrap();

    assert_eq!(login_response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_login_400_invalid_password() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let login_body = LoginEmailBody {
        email: "user@example.com".to_string(),
        password: "invalid_password".to_string(),
    };

    let login_response = instance_state
        .reqwest_client
        .post(format!("{}/auth/login", &instance_state.server_url))
        .json(&login_body)
        .send()
        .await
        .unwrap();

    assert_eq!(login_response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_login_401_user_not_found() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let password = Faker.fake::<Password>();

    let login_body = LoginEmailBody {
        email: "nonexistent_user@example.com".to_string(),
        password: password.as_str().to_string(),
    };

    let login_response = instance_state
        .reqwest_client
        .post(format!("{}/auth/login", &instance_state.server_url))
        .json(&login_body)
        .send()
        .await
        .unwrap();

    assert_eq!(login_response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_login_401_invalid_password() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let (user, _password) = instance_state.signup_user().await;
    let invalid_password = Faker.fake::<Password>();

    let login_body = LoginEmailBody {
        email: user.email.to_string(),
        password: invalid_password.as_str().to_string(),
    };

    let login_response = instance_state
        .reqwest_client
        .post(format!("{}/auth/login", &instance_state.server_url))
        .json(&login_body)
        .send()
        .await
        .unwrap();

    assert_eq!(login_response.status(), StatusCode::UNAUTHORIZED);
}
