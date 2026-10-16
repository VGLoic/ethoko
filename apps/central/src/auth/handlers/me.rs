use axum::{Json, extract::State, http::StatusCode};

use crate::{
    auth::{http_responses::UserResponse, principal::CentralUiBffWithUser, state::AuthState},
    router::ApiError,
};
pub async fn handle_me(
    State(_state): State<AuthState>,
    principal: CentralUiBffWithUser,
) -> Result<(StatusCode, Json<UserResponse>), ApiError> {
    Ok((StatusCode::OK, Json(principal.user.into())))
}
