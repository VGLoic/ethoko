use crate::{
    auth::models::{
        requests::signup_email::{
            SignupEmailBody, SignupEmailError, SignupEmailRequest, SignupEmailRequestError,
        },
        users_response::UserResponse,
    },
    newtypes::{email::EmailError, handle::HandleError, password::PasswordError},
    router::{ApiError, AppState},
};
use axum::{Json, extract::State, http::StatusCode};

pub async fn handle_signup_email(
    State(state): State<AppState>,
    Json(body): Json<SignupEmailBody>,
) -> Result<(StatusCode, Json<UserResponse>), ApiError> {
    let request = SignupEmailRequest::new(body.email, body.handle, body.password)?;

    let (user, _auth_credential) = state.auth_service.signup_with_email(request).await?;

    Ok((StatusCode::CREATED, Json(user.into())))
}

impl From<SignupEmailError> for ApiError {
    fn from(err: SignupEmailError) -> Self {
        match err {
            SignupEmailError::EmailAlreadyExists(email) => {
                ApiError::UnprocessableEntity(format!("Email {} already exists", email))
            }
            SignupEmailError::HandleAlreadyExists(handle) => {
                ApiError::UnprocessableEntity(format!("Handle {} already exists", handle))
            }
            SignupEmailError::Unknown(e) => ApiError::InternalServerError(e),
        }
    }
}

impl From<SignupEmailRequestError> for ApiError {
    fn from(err: SignupEmailRequestError) -> Self {
        match err {
            SignupEmailRequestError::InvalidEmail(e) => {
                ApiError::BadRequest(match e {
                    EmailError::Empty => "\"email\": empty value not allowed".to_string(),
                    EmailError::InvalidFormat => "\"email\": invalid format".to_string(),
                })
            },
            SignupEmailRequestError::InvalidHandle(e) => {
                ApiError::BadRequest(match e {
                    HandleError::Empty => "\"handle\": empty value not allowed".to_string(),
                    HandleError::InvalidFormat => "\"handle\": invalid format, expected only alphanumeric characters and hyphens, length between 4 and 31".to_string(),
                    HandleError::InvalidSpecificHandle => "\"handle\": value is not allowed".to_string(),
                })
            },
            SignupEmailRequestError::InvalidPassword(e) => {
                ApiError::BadRequest(match e {
                    PasswordError::Empty => "\"password\": empty value not allowed".to_string(),
                    PasswordError::InvalidFormat => "\"password\": invalid format, expected at least 8 characters, including uppercase, lowercase, digit and special character".to_string(),
                })
            },
            SignupEmailRequestError::Unknown(e) => ApiError::InternalServerError(e),
        }
    }
}
