use crate::{
    auth::{models::requests::logout::LogoutError, principal::CentralUiBffWithUser},
    router::{ApiError, AppState},
};
use axum::{extract::State, http::StatusCode};

pub async fn handle_logout(
    State(state): State<AppState>,
    principal: CentralUiBffWithUser,
) -> Result<StatusCode, ApiError> {
    state
        .auth_service
        .revoke_session_token(principal.user.id, &principal.session_token_hash)
        .await?;

    Ok(StatusCode::OK)
}

impl From<LogoutError> for ApiError {
    fn from(err: LogoutError) -> Self {
        ApiError::InternalServerError(err.into())
    }
}
