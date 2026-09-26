use axum::{Json, extract::State, http::StatusCode};

use crate::{
    auth::models::{
        http_responses::UserResponse,
        requests::verify_email::{
            HttpVerifyEmailBody, VerifyEmailError, VerifyEmailRequest, VerifyEmailRequestError,
        },
    },
    newtypes::email::EmailError,
    router::{ApiError, AppState, UnprocessableEntityError},
};

pub async fn handle_verify_email(
    State(state): State<AppState>,
    Json(body): Json<HttpVerifyEmailBody>,
) -> Result<(StatusCode, Json<UserResponse>), ApiError> {
    let request = VerifyEmailRequest::new(body.otp, body.email)?;

    let user = state.auth_service.verify_email(request).await?;

    Ok((StatusCode::OK, Json(user.into())))
}

impl From<VerifyEmailRequestError> for ApiError {
    fn from(value: VerifyEmailRequestError) -> Self {
        match value {
            VerifyEmailRequestError::InvalidEmail(e) => {
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

impl From<VerifyEmailError> for ApiError {
    fn from(value: VerifyEmailError) -> Self {
        match value {
            VerifyEmailError::EmailAlreadyVerified => UnprocessableEntityError::new(
                "ETKAVE01".to_string(),
                "email is already verified".to_string(),
            )
            .into(),
            VerifyEmailError::InvalidOtp => {
                UnprocessableEntityError::new("ETKAVE02".to_string(), "OTP is invalid".to_string())
                    .into()
            }
            VerifyEmailError::OtpExpired => {
                UnprocessableEntityError::new("ETKAVE03".to_string(), "OTP has expired".to_string())
                    .into()
            }
            VerifyEmailError::NotFound => ApiError::NotFound,
            VerifyEmailError::Unknown(e) => ApiError::InternalServerError(e),
        }
    }
}
