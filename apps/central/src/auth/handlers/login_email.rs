use crate::{
    auth::{
        models::requests::login_email::{
            LoginEmailBody, LoginEmailError, LoginEmailRequest, LoginEmailRequestError,
        },
        users_response::LoginResponse,
    },
    newtypes::{email::EmailError, password::PasswordError},
    router::{ApiError, AppState},
};
use axum::{Json, extract::State, http::StatusCode};

pub async fn handle_login_email(
    State(state): State<AppState>,
    Json(body): Json<LoginEmailBody>,
) -> Result<(StatusCode, Json<LoginResponse>), ApiError> {
    let request = LoginEmailRequest::new(body.email, body.password)?;

    let (_user, opaque_token_value) = state.auth_service.login_with_email(request).await?;

    Ok((
        StatusCode::OK,
        Json(LoginResponse {
            token: opaque_token_value.as_str().to_string(),
        }),
    ))
}

impl From<LoginEmailError> for ApiError {
    fn from(err: LoginEmailError) -> Self {
        match err {
            LoginEmailError::UserNotFound => {
                ApiError::Unauthorized("Invalid credentials".to_string())
            }
            LoginEmailError::InvalidCredentials => {
                ApiError::Unauthorized("Invalid credentials".to_string())
            }
            LoginEmailError::Unknown(e) => ApiError::InternalServerError(e),
        }
    }
}

impl From<LoginEmailRequestError> for ApiError {
    fn from(err: LoginEmailRequestError) -> Self {
        match err {
                LoginEmailRequestError::InvalidEmail(e) => {
                    ApiError::BadRequest(match e {
                        EmailError::Empty => "\"email\": empty value not allowed".to_string(),
                        EmailError::InvalidFormat => "\"email\": invalid format".to_string(),
                    })
                },
                LoginEmailRequestError::InvalidPassword(e) => {
                    ApiError::BadRequest(match e {
                        PasswordError::Empty => "\"password\": empty value not allowed".to_string(),
                        PasswordError::InvalidFormat => "\"password\": invalid format, expected at least 8 characters, including uppercase, lowercase, digit and special character".to_string(),
                    })
                }
            }
    }
}
