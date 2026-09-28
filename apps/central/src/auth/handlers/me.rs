use axum::{Json, extract::State, http::StatusCode};

use crate::{
    auth::{http_responses::UserResponse, principal::CentralUiBffWithUser},
    router::{ApiError, AppState},
};
pub async fn handle_me(
    State(_state): State<AppState>,
    principal: CentralUiBffWithUser,
) -> Result<(StatusCode, Json<UserResponse>), ApiError> {
    Ok((StatusCode::OK, Json(principal.user.into())))
}
