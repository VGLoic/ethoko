use axum::{Json, extract::State, http::StatusCode};

use crate::{
    auth::{authenticated_user::AuthenticatedUser, users_response::UserResponse},
    router::{ApiError, AppState},
};
pub async fn handle_me(
    State(_state): State<AppState>,
    authenticated_user: AuthenticatedUser,
) -> Result<(StatusCode, Json<UserResponse>), ApiError> {
    Ok((StatusCode::OK, Json(authenticated_user.user.into())))
}
