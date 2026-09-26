use crate::{
    auth::{authenticated_user::AuthenticatedUser, models::requests::logout::LogoutError},
    router::{ApiError, AppState},
};
use axum::{extract::State, http::StatusCode};

pub async fn handle_logout(
    State(state): State<AppState>,
    authenticated_user: AuthenticatedUser,
) -> Result<StatusCode, ApiError> {
    state
        .auth_service
        .revoke_session_token(
            authenticated_user.user.id,
            &authenticated_user.session_token_hash,
        )
        .await?;

    Ok(StatusCode::OK)
}

impl From<LogoutError> for ApiError {
    fn from(err: LogoutError) -> Self {
        ApiError::InternalServerError(err.into())
    }
}
