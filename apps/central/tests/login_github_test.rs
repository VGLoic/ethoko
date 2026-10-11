use axum::http::StatusCode;
use ethoko_central::{
    auth::requests::{
        login_github_callback::{HttpLoginGithubCallbackBody, HttpLoginGithubCallbackResponse},
        login_github_start::HttpLoginGithubStartResponse,
    },
    clients::github::models::{GithubApiUserEmailsResponseItem, GithubApiUserResponse},
    newtypes::email::Email,
    router::UnprocessableEntityError,
};
mod common;
use common::{AuthActions, TestConfigBuilder, central_ui_bff_principal_headers, setup_instance};
use fake::{Fake, Faker, faker};

use crate::common::central_ui_bff_with_user_principal_headers;

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
            .with_oauth_transaction_ttl_seconds(1)
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
            state: start_response.state,
        })
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = response.json::<UnprocessableEntityError>().await.unwrap();
    assert_eq!(error.code, "ETKLGC03");
}

#[tokio::test]
async fn test_login_github_callback_422_with_already_taken_email() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let (already_signed_up_user, _password) = instance_state.signup_user().await;

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

    let github_user = GithubApiUserResponse {
        id: Faker.fake::<u64>(),
        login: faker::internet::en::Username().fake::<String>(),
    };
    let github_user_emails = vec![GithubApiUserEmailsResponseItem {
        email: already_signed_up_user.email.to_string(),
        verified: true,
        primary: true,
    }];

    instance_state.github_client.set_next_user(github_user);
    instance_state
        .github_client
        .set_next_user_emails(github_user_emails);

    let response = instance_state
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
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error = response.json::<UnprocessableEntityError>().await.unwrap();
    assert_eq!(error.code, "ETKLGC01");
}

#[tokio::test]
async fn test_login_github_callback_500_with_invalid_code() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let email = Faker.fake::<Email>();
    let github_user = GithubApiUserResponse {
        id: Faker.fake::<u64>(),
        login: faker::internet::en::Username().fake::<String>(),
    };
    let github_user_emails = vec![GithubApiUserEmailsResponseItem {
        email: email.to_string(),
        verified: true,
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

    let response = instance_state
        .reqwest_client
        .post(format!(
            "{}/auth/login/github/callback",
            &instance_state.server_url
        ))
        .headers(central_ui_bff_principal_headers())
        .json(&HttpLoginGithubCallbackBody {
            code: "some_code".to_string(),
            state: start_response.state,
        })
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn test_login_github_callback_200_with_newly_created_user() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let email = Faker.fake::<Email>();
    let github_user = GithubApiUserResponse {
        id: Faker.fake::<u64>(),
        login: faker::internet::en::Username().fake::<String>(),
    };
    let github_user_emails = vec![GithubApiUserEmailsResponseItem {
        email: email.to_string(),
        verified: true,
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

    let response = instance_state
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
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let response_body: HttpLoginGithubCallbackResponse = response.json().await.unwrap();
    assert!(response_body.token.starts_with("etks_"));
}

#[tokio::test]
async fn test_login_github_callback_200_with_existing_user() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let email = Faker.fake::<Email>();
    let github_user = GithubApiUserResponse {
        id: Faker.fake::<u64>(),
        login: faker::internet::en::Username().fake::<String>(),
    };
    let github_user_emails = vec![GithubApiUserEmailsResponseItem {
        email: email.to_string(),
        verified: true,
        primary: true,
    }];

    // First cycle: create the user by going through the GitHub login flow

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

    instance_state
        .github_client
        .set_next_user(github_user.clone());
    instance_state
        .github_client
        .set_next_user_emails(github_user_emails.clone());

    instance_state
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
        .unwrap();

    // Second cycle: attempt to log in with the existing user

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

    let response = instance_state
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
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let response_body: HttpLoginGithubCallbackResponse = response.json().await.unwrap();
    assert!(response_body.token.starts_with("etks_"));
}

#[tokio::test]
async fn test_login_github_token_valid() {
    let instance_state = setup_instance(&TestConfigBuilder::build_default())
        .await
        .unwrap();

    let email = Faker.fake::<Email>();
    let github_user = GithubApiUserResponse {
        id: Faker.fake::<u64>(),
        login: faker::internet::en::Username().fake::<String>(),
    };
    let github_user_emails = vec![GithubApiUserEmailsResponseItem {
        email: email.to_string(),
        verified: true,
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

    let response = instance_state
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
        .unwrap();

    let me_response = instance_state
        .reqwest_client
        .get(format!("{}/auth/me", &instance_state.server_url))
        .headers(central_ui_bff_with_user_principal_headers(&response.token))
        .send()
        .await
        .unwrap();

    assert_eq!(me_response.status(), StatusCode::OK);
}
