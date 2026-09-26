use crate::{
    auth::models::requests::resend_verification_otp::{
        HttpResendVerificationOtpBody, ResendVerificationOtpError, ResendVerificationOtpRequest,
        ResendVerificationOtpRequestError,
    },
    newtypes::email::EmailError,
    router::{ApiError, AppState, UnprocessableEntityError},
};
use axum::{Json, extract::State, http::StatusCode};

pub async fn handle_resend_verification_otp(
    State(state): State<AppState>,
    Json(body): Json<HttpResendVerificationOtpBody>,
) -> Result<(StatusCode, Json<()>), ApiError> {
    let request = ResendVerificationOtpRequest::new(body.email)?;

    state.auth_service.resend_verification_otp(request).await?;

    Ok((StatusCode::OK, Json(())))
}

impl From<ResendVerificationOtpRequestError> for ApiError {
    fn from(err: ResendVerificationOtpRequestError) -> Self {
        match err {
            ResendVerificationOtpRequestError::InvalidEmail(e) => {
                UnprocessableEntityError::new_body_validation(
                    "email".to_string(),
                    match e {
                        EmailError::Empty => "empty value not allowed".to_string(),
                        EmailError::InvalidFormat => "invalid format".to_string(),
                    },
                )
                .into()
            }
        }
    }
}

impl From<ResendVerificationOtpError> for ApiError {
    fn from(value: ResendVerificationOtpError) -> Self {
        match value {
            ResendVerificationOtpError::UserNotFound => ApiError::NotFound,
            ResendVerificationOtpError::UserAlreadyVerified => UnprocessableEntityError::new(
                "ETKARV01".to_string(),
                "email is already verified".to_string(),
            )
            .into(),
            ResendVerificationOtpError::CooldownNotElapsed => UnprocessableEntityError::new(
                "ETKARV02".to_string(),
                "cooldown period has not elapsed yet for requesting a new verification code"
                    .to_string(),
            )
            .into(),
            ResendVerificationOtpError::Unknown(e) => ApiError::InternalServerError(e),
        }
    }
}
