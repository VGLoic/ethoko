use crate::{
    auth::{models::requests::reset_password::*, principal::CentralUiBff, state::AuthState},
    newtypes::password::PasswordError,
    router::{ApiError, UnprocessableEntityError},
};
use axum::{Json, extract::State};

pub async fn handle_reset_password(
    State(state): State<AuthState>,
    _principal: CentralUiBff,
    Json(body): Json<HttpResetPasswordBody>,
) -> Result<Json<()>, ApiError> {
    let request = ResetPasswordRequest::new(body.token, body.password)?;
    state.auth_service.reset_password(request).await?;
    Ok(Json(()))
}

impl From<ResetPasswordRequestError> for ApiError {
    fn from(error: ResetPasswordRequestError) -> Self {
        match error {
            ResetPasswordRequestError::InvalidPassword(error) => {
                UnprocessableEntityError::new_body_validation("password".to_string(), match error {
                    PasswordError::Empty => "empty value not allowed".to_string(),
                    PasswordError::InvalidFormat => "invalid format, expected at least 8 characters, including uppercase, lowercase, digit and special character".to_string(),
                }).into()
            }
            ResetPasswordRequestError::Unknown(error) => ApiError::InternalServerError(error),
        }
    }
}

impl From<ResetPasswordError> for ApiError {
    fn from(error: ResetPasswordError) -> Self {
        match error {
            ResetPasswordError::InvalidToken => UnprocessableEntityError::new(
                "ETKARP01".into(),
                "This password reset link is invalid or expired.".into(),
            )
            .into(),
            ResetPasswordError::Unknown(error) => ApiError::InternalServerError(error),
        }
    }
}
