use crate::{
    newtypes::{
        email::{Email, EmailError},
        handle::{Handle, HandleError},
        password::PasswordError,
    },
    router::{ApiError, AppState},
    users::models::{email_signup::EmailSignupError, user::User},
};
use axum::{Json, Router, extract::State, http::StatusCode, routing::post};
use serde::{Deserialize, Serialize};

use super::models::email_signup::{EmailSignupRequest, EmailSignupRequestError};

pub fn auth_router() -> Router<AppState> {
    Router::new().route("/signup/email", post(handle_signup_email))
}

#[derive(Deserialize, Serialize)]
pub struct SignupEmailBody {
    pub email: String,
    pub handle: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub email: Email,
    pub handle: Handle,
    pub email_verified: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl From<User> for UserResponse {
    fn from(user: User) -> Self {
        UserResponse {
            email: user.email,
            handle: user.handle,
            email_verified: user.email_verified,
            created_at: user.created_at,
            updated_at: user.updated_at,
        }
    }
}

async fn handle_signup_email(
    State(state): State<AppState>,
    Json(body): Json<SignupEmailBody>,
) -> Result<(StatusCode, Json<UserResponse>), ApiError> {
    let request = EmailSignupRequest::new(body.email, body.handle, body.password)?;

    let (user, _auth_credential) = state.users_service.signup_with_email(request).await?;

    Ok((StatusCode::CREATED, Json(user.into())))
}

impl From<EmailSignupError> for ApiError {
    fn from(err: EmailSignupError) -> Self {
        match err {
            EmailSignupError::EmailAlreadyExists(email) => {
                ApiError::UnprocessableEntity(format!("Email {} already exists", email))
            }
            EmailSignupError::HandleAlreadyExists(handle) => {
                ApiError::UnprocessableEntity(format!("Handle {} already exists", handle))
            }
            EmailSignupError::Unknown(e) => ApiError::InternalServerError(e),
        }
    }
}

impl From<EmailSignupRequestError> for ApiError {
    fn from(err: EmailSignupRequestError) -> Self {
        match err {
            EmailSignupRequestError::InvalidEmail(e) => {
                ApiError::BadRequest(match e {
                    EmailError::Empty => "\"email\": empty value not allowed".to_string(),
                    EmailError::InvalidFormat => "\"email\": invalid format".to_string(),
                })
            },
            EmailSignupRequestError::InvalidHandle(e) => {
                ApiError::BadRequest(match e {
                    HandleError::Empty => "\"handle\": empty value not allowed".to_string(),
                    HandleError::InvalidFormat => "\"handle\": invalid format, expected only alphanumeric characters and hyphens, length between 4 and 31".to_string(),
                    HandleError::InvalidSpecificHandle => "\"handle\": value is not allowed".to_string(),
                })
            },
            EmailSignupRequestError::InvalidPassword(e) => {
                ApiError::BadRequest(match e {
                    PasswordError::Empty => "\"password\": empty value not allowed".to_string(),
                    PasswordError::InvalidFormat => "\"password\": invalid format, expected at least 8 characters, including uppercase, lowercase, digit and special character".to_string(),
                })
            },
            EmailSignupRequestError::Unknown(e) => ApiError::InternalServerError(e),
        }
    }
}
