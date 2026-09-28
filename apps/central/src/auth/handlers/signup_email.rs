use crate::{
    auth::{
        models::{
            http_responses::UserResponse,
            requests::signup_email::{
                HttpSignupEmailBody, SignupEmailError, SignupEmailRequest, SignupEmailRequestError,
            },
        },
        principal::CentralUiBff,
    },
    newtypes::{email::EmailError, handle::HandleError, password::PasswordError},
    router::{ApiError, AppState, UnprocessableEntityError},
};
use axum::{Json, extract::State, http::StatusCode};

pub async fn handle_signup_email(
    State(state): State<AppState>,
    _principal: CentralUiBff,
    Json(body): Json<HttpSignupEmailBody>,
) -> Result<(StatusCode, Json<UserResponse>), ApiError> {
    let request = SignupEmailRequest::new(body.email, body.handle, body.password)?;

    let (user, _auth_credential) = state.auth_service.signup_with_email(request).await?;

    Ok((StatusCode::CREATED, Json(user.into())))
}

impl From<SignupEmailError> for ApiError {
    fn from(err: SignupEmailError) -> Self {
        match err {
            SignupEmailError::EmailAlreadyExists(email) => {
                UnprocessableEntityError::new(
                    "ETKAS01".to_string(),
                    format!("The provided email is already registered: {}", email),
                )
                .into()
                // UnprocessableEntityErrorCodeResponse::SignupEmailAlreadyExists { email }.into()
            }
            SignupEmailError::HandleAlreadyExists(handle) => UnprocessableEntityError::new(
                "ETKAS02".to_string(),
                format!("The provided handle is already taken: {handle}"),
            )
            .into(),
            SignupEmailError::Unknown(e) => ApiError::InternalServerError(e),
        }
    }
}

impl From<SignupEmailRequestError> for ApiError {
    fn from(err: SignupEmailRequestError) -> Self {
        match err {
            SignupEmailRequestError::InvalidEmail(e) => {
                UnprocessableEntityError::new_body_validation("email".to_string(), match e {
                    EmailError::Empty => "empty value not allowed".to_string(),
                    EmailError::InvalidFormat => "invalid format".to_string(),
                }).into()
            },
            SignupEmailRequestError::InvalidHandle(e) => {
                match e {
                    HandleError::Empty => UnprocessableEntityError::new_body_validation("handle".to_string(), "empty value not allowed".to_string()).into(),
                    HandleError::InvalidFormat => UnprocessableEntityError::new_body_validation("handle".to_string(),"invalid format, expected only alphanumeric characters and hyphens, length between 4 and 31".to_string()).into(),
                    HandleError::InvalidSpecificHandle => UnprocessableEntityError::new("ETKAS02".to_string(), "The provided handle is not allowed.".to_string()).into(),
                }
            },
            SignupEmailRequestError::InvalidPassword(e) => {
                UnprocessableEntityError::new_body_validation("password".to_string(), match e {
                    PasswordError::Empty => "empty value not allowed".to_string(),
                    PasswordError::InvalidFormat => "invalid format, expected at least 8 characters, including uppercase, lowercase, digit and special character".to_string(),
                }).into()
            },
            SignupEmailRequestError::Unknown(e) => ApiError::InternalServerError(e),
        }
    }
}
