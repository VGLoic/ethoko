use crate::{
    auth::{
        principal::CentralUiBff,
        requests::login_github_start::{HttpLoginGithubStartResponse, LoginGithubStartError},
    },
    router::{ApiError, AppState},
};
use axum::{Json, extract::State, http::StatusCode};

pub async fn handle_login_github_start(
    State(state): State<AppState>,
    _principal: CentralUiBff,
) -> Result<(StatusCode, Json<HttpLoginGithubStartResponse>), ApiError> {
    let result = state.auth_service.start_login_with_github().await?;

    Ok((
        StatusCode::CREATED,
        Json(HttpLoginGithubStartResponse {
            auth_url: result.auth_url,
            state: result.state.secret().to_owned(),
        }),
    ))
}

impl From<LoginGithubStartError> for ApiError {
    fn from(value: LoginGithubStartError) -> Self {
        match value {
            LoginGithubStartError::Unknown(e) => ApiError::InternalServerError(e),
        }
    }
}
