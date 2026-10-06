use crate::{
    auth::{
        http_responses::UserResponse,
        principal::CentralUiBff,
        requests::login_github_callback::{
            HttpLoginGithubCallbackBody, LoginGithubCallbackError, LoginGithubCallbackRequest,
        },
    },
    router::{ApiError, AppState, UnprocessableEntityError},
};
use axum::{Json, extract::State, http::StatusCode};

pub async fn handle_login_github_callback(
    State(state): State<AppState>,
    _principal: CentralUiBff,
    Json(body): Json<HttpLoginGithubCallbackBody>,
) -> Result<(StatusCode, Json<UserResponse>), ApiError> {
    let request = LoginGithubCallbackRequest::new(body.code, body.state);

    state
        .auth_service
        .authorize_login_with_github(request)
        .await?;

    Err(anyhow::anyhow!("oh no").into())
}

impl From<LoginGithubCallbackError> for ApiError {
    fn from(value: LoginGithubCallbackError) -> Self {
        match value {
            LoginGithubCallbackError::PrimaryEmailCollision => UnprocessableEntityError::new(
                "ETKLGC01".to_string(),
                "primary email collision with existing user".to_string(),
            )
            .into(),
            LoginGithubCallbackError::OauthTransactionNotFound => UnprocessableEntityError::new(
                "ETKLGC02".to_string(),
                "oauth transaction has not been found".to_string(),
            )
            .into(),
            LoginGithubCallbackError::OauthTransactionExpired => UnprocessableEntityError::new(
                "ETKLGC03".to_string(),
                "oauth transaction has expired".to_string(),
            )
            .into(),
            LoginGithubCallbackError::Unknown(e) => ApiError::InternalServerError(e),
        }
    }
}
