use crate::{
    auth::{
        models::requests::{password_recovery::*, signup_email::SignupEmailRequestError},
        password_hasher,
        principal::CentralUiBff,
        state::AuthState,
    },
    newtypes::{
        email::{Email, EmailError},
        password::Password,
    },
    router::{ApiError, UnprocessableEntityError},
};
use axum::{Json, extract::State};

pub async fn handle_forgot_password(
    State(state): State<AuthState>,
    _principal: CentralUiBff,
    Json(body): Json<HttpForgotPasswordBody>,
) -> Result<Json<HttpForgotPasswordResponse>, ApiError> {
    let email = Email::new(&body.email).map_err(|error| {
        ApiError::from(UnprocessableEntityError::new_body_validation(
            "email".to_string(),
            match error {
                EmailError::Empty => "empty value not allowed".to_string(),
                EmailError::InvalidFormat => "invalid format".to_string(),
            },
        ))
    })?;
    let cooldown_seconds = state
        .auth_service
        .forgot_password(email)
        .await
        .map_err(ApiError::InternalServerError)?;
    Ok(Json(HttpForgotPasswordResponse {
        message: "If this account is eligible for password recovery, you’ll receive an email.",
        cooldown_seconds,
    }))
}

pub async fn handle_reset_password(
    State(state): State<AuthState>,
    _principal: CentralUiBff,
    Json(body): Json<HttpResetPasswordBody>,
) -> Result<Json<()>, ApiError> {
    let password =
        Password::new(&body.password).map_err(SignupEmailRequestError::InvalidPassword)?;
    let hash = password_hasher::hash_password(&password).map_err(ApiError::InternalServerError)?;
    state.auth_service.reset_password(&body.token, hash).await?;
    Ok(Json(()))
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
