use crate::{
    auth::{
        models::requests::signup_email::{
            HttpSignupEmailBody, HttpSignupEmailResponse, SignupEmailError, SignupEmailRequest,
            SignupEmailRequestError,
        },
        principal::CentralUiBff,
    },
    newtypes::{email::EmailError, password::PasswordError},
    router::{ApiError, AppState, UnprocessableEntityError},
};
use axum::{Json, extract::State, http::StatusCode};

pub async fn handle_signup_email(
    State(state): State<AppState>,
    _principal: CentralUiBff,
    Json(body): Json<HttpSignupEmailBody>,
) -> Result<(StatusCode, Json<HttpSignupEmailResponse>), ApiError> {
    let request = SignupEmailRequest::new(body.email, body.password)?;

    let (user, _auth_credential) = state.auth_service.signup_with_email(request).await?;

    Ok((
        StatusCode::CREATED,
        Json(HttpSignupEmailResponse::from(user)),
    ))
}

impl From<SignupEmailError> for ApiError {
    fn from(err: SignupEmailError) -> Self {
        match err {
            SignupEmailError::EmailAlreadyExists(email) => UnprocessableEntityError::new(
                "ETKAS01".to_string(),
                format!("The provided email is already registered: {}", email),
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
