use axum::http::StatusCode;
use ethoko_central::{
    auth::requests::login_email::{HttpLoginEmailBody, HttpLoginEmailResponse},
    newtypes::password::Password,
    router::UnprocessableEntityError,
};
mod common;
use common::{AuthActions, TestConfigBuilder, setup_instance};
use fake::{Fake, Faker};

#[tokio::test]
async fn test_login_200() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let (user, password) = instance_state.signup_user().await;

    let login_body = HttpLoginEmailBody {
        email: user.email.to_string(),
        password: password.as_str().to_string(),
    };

    let login_response = instance_state
        .reqwest_client
        .post(format!("{}/auth/login/email", &instance_state.server_url))
        .json(&login_body)
        .send()
        .await
        .unwrap();

    assert_eq!(login_response.status(), StatusCode::OK);
    let response_body: HttpLoginEmailResponse = login_response.json().await.unwrap();
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
        .post(format!("{}/auth/login/email", &instance_state.server_url))
        .json(&HttpLoginEmailBody {
            email: user.email.to_string(),
            password: password.as_str().to_string(),
        })
        .send()
        .await
        .unwrap()
        .json::<HttpLoginEmailResponse>()
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
async fn test_login_422_invalid_email() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let login_body = HttpLoginEmailBody {
        email: "invalid_email".to_string(),
        password: "password".to_string(),
    };

    let login_response = instance_state
        .reqwest_client
        .post(format!("{}/auth/login/email", &instance_state.server_url))
        .json(&login_body)
        .send()
        .await
        .unwrap();

    assert_eq!(login_response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = login_response
        .json::<UnprocessableEntityError>()
        .await
        .unwrap();
    assert_eq!(error.code, "ETKAG01");
}

#[tokio::test]
async fn test_login_422_invalid_password_format() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let login_body = HttpLoginEmailBody {
        email: "user@example.com".to_string(),
        password: "invalid_password_format".to_string(),
    };

    let login_response = instance_state
        .reqwest_client
        .post(format!("{}/auth/login/email", &instance_state.server_url))
        .json(&login_body)
        .send()
        .await
        .unwrap();

    assert_eq!(login_response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = login_response
        .json::<UnprocessableEntityError>()
        .await
        .unwrap();
    assert_eq!(error.code, "ETKAG01");
}

#[tokio::test]
async fn test_login_422_user_not_found() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let password = Faker.fake::<Password>();

    let login_body = HttpLoginEmailBody {
        email: "nonexistent_user@example.com".to_string(),
        password: password.as_str().to_string(),
    };

    let login_response = instance_state
        .reqwest_client
        .post(format!("{}/auth/login/email", &instance_state.server_url))
        .json(&login_body)
        .send()
        .await
        .unwrap();

    assert_eq!(login_response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = login_response
        .json::<UnprocessableEntityError>()
        .await
        .unwrap();
    assert_eq!(error.code, "ETKAL01");
}

#[tokio::test]
async fn test_login_422_invalid_password() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let (user, _password) = instance_state.signup_user().await;
    let invalid_password = Faker.fake::<Password>();

    let login_body = HttpLoginEmailBody {
        email: user.email.to_string(),
        password: invalid_password.as_str().to_string(),
    };

    let login_response = instance_state
        .reqwest_client
        .post(format!("{}/auth/login/email", &instance_state.server_url))
        .json(&login_body)
        .send()
        .await
        .unwrap();

    assert_eq!(login_response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = login_response
        .json::<UnprocessableEntityError>()
        .await
        .unwrap();
    assert_eq!(error.code, "ETKAL01");
}
