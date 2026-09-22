use crate::{
    auth::models::requests::login_email::{
        HttpLoginEmailBody, HttpLoginEmailResponse, LoginEmailError, LoginEmailRequest,
        LoginEmailRequestError,
    },
    newtypes::{email::EmailError, password::PasswordError},
    router::{ApiError, AppState, UnprocessableEntityError},
};
use axum::{Json, extract::State, http::StatusCode};

pub async fn handle_login_email(
    State(state): State<AppState>,
    Json(body): Json<HttpLoginEmailBody>,
) -> Result<(StatusCode, Json<HttpLoginEmailResponse>), ApiError> {
    let request = LoginEmailRequest::new(body.email, body.password)?;

    let opaque_token_value = state.auth_service.login_with_email(request).await?;

    Ok((
        StatusCode::OK,
        Json(HttpLoginEmailResponse {
            token: opaque_token_value.as_str().to_string(),
        }),
    ))
}

impl From<LoginEmailError> for ApiError {
    fn from(err: LoginEmailError) -> Self {
        match err {
            LoginEmailError::UserNotFound => UnprocessableEntityError::new(
                "ETKAL01".to_string(),
                "invalid credentials".to_string(),
            )
            .into(),
            LoginEmailError::InvalidCredentials => UnprocessableEntityError::new(
                "ETKAL01".to_string(),
                "invalid credentials".to_string(),
            )
            .into(),
            LoginEmailError::Unknown(e) => ApiError::InternalServerError(e),
        }
    }
}

impl From<LoginEmailRequestError> for ApiError {
    fn from(err: LoginEmailRequestError) -> Self {
        match err {
                LoginEmailRequestError::InvalidEmail(e) => UnprocessableEntityError::new_body_validation("email".to_string(), match e {
                    EmailError::Empty => "empty value not allowed".to_string(),
                    EmailError::InvalidFormat => "invalid format".to_string(),
                }).into(),
                LoginEmailRequestError::InvalidPassword(e) => UnprocessableEntityError::new_body_validation("password".to_string(), match e {
                    PasswordError::Empty => "empty value not allowed".to_string(),
                    PasswordError::InvalidFormat => "invalid format, expected at least 8 characters, including uppercase, lowercase, digit and special character".to_string(),
                }).into()
            }
    }
}
