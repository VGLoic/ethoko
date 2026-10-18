use crate::{
    auth::{
        password_hasher,
        principal::CentralUiBff,
        requests::password_recovery::{
            HttpForgotPasswordBody, HttpResetPasswordBody, ResetPasswordError,
        },
        state::AuthState,
    },
    newtypes::{email::Email, password::Password},
    router::{ApiError, UnprocessableEntityError},
};
use axum::{Json, extract::State};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
pub struct ValidateResetBody {
    token: String,
}

pub async fn handle_validate_reset(
    State(state): State<AuthState>,
    _principal: CentralUiBff,
    Json(body): Json<ValidateResetBody>,
) -> Result<Json<Value>, ApiError> {
    if !state
        .auth_service
        .password_reset_is_valid(&body.token)
        .await?
    {
        return Err(UnprocessableEntityError::new(
            "ETKARP01".into(),
            "Invalid or expired reset link".into(),
        )
        .into());
    }
    Ok(Json(json!({"valid": true})))
}

pub async fn handle_forgot_password(
    State(state): State<AuthState>,
    _principal: CentralUiBff,
    Json(body): Json<HttpForgotPasswordBody>,
) -> Result<Json<Value>, ApiError> {
    let email = Email::new(&body.email).map_err(|_| {
        UnprocessableEntityError::new_body_validation("email".into(), "invalid format".into())
    })?;
    state.auth_service.forgot_password(email).await?;
    Ok(Json(json!({
        "message": "If this account is eligible for password recovery, you’ll receive an email.",
        "cooldownSeconds": state.auth_service.password_reset_cooldown_seconds(),
    })))
}

pub async fn handle_reset_password(
    State(state): State<AuthState>,
    _principal: CentralUiBff,
    Json(body): Json<HttpResetPasswordBody>,
) -> Result<Json<Value>, ApiError> {
    let password = Password::new(&body.password).map_err(|_| UnprocessableEntityError::new_body_validation("password".into(), "Expected at least 8 UTF-8 bytes, uppercase, lowercase, a digit and a special character".into()))?;
    let hash = password_hasher::hash_password(&password)?;
    state
        .auth_service
        .reset_password(&body.token, hash)
        .await
        .map_err(|e| match e {
            ResetPasswordError::InvalidToken => ApiError::from(UnprocessableEntityError::new(
                "ETKARP01".into(),
                "Invalid or expired reset link".into(),
            )),
            ResetPasswordError::Unknown(error) => ApiError::InternalServerError(error),
        })?;
    Ok(Json(json!({"message": "Password reset. Please log in."})))
}
