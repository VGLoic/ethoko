use crate::{
    auth::{models::requests::forgot_password::*, principal::CentralUiBff, state::AuthState},
    newtypes::email::{Email, EmailError},
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
    Ok(Json(HttpForgotPasswordResponse { cooldown_seconds }))
}
