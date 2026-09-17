use crate::{
    auth::{
        handlers::{html_templates::HtmlTemplate, signup_email_form_render::SignupTemplate},
        requests::signup_email::{SignupEmailError, SignupEmailRequest, SignupEmailRequestError},
    },
    newtypes::{email::EmailError, handle::Handle, handle::HandleError, password::PasswordError},
};
use askama::Template;
use axum::{
    extract::{Form, State},
    response::IntoResponse,
};
use serde::Deserialize;

use super::html_templates::TemplateError;
use crate::{newtypes::email::Email, router::AppState};

#[derive(Template)]
#[template(path = "signup_success.html")]
pub struct SignupSuccessTemplate {
    email: Email,
    handle: Handle,
}

pub enum SignupActionResponse {
    Success(SignupSuccessTemplate),
    Error(SignupTemplate),
}

impl IntoResponse for SignupActionResponse {
    fn into_response(self) -> axum::response::Response {
        match self {
            SignupActionResponse::Success(template) => HtmlTemplate::new(template).into_response(),
            SignupActionResponse::Error(template) => HtmlTemplate::new(template).into_response(),
        }
    }
}

#[derive(Deserialize)]
pub struct SignupActionFormData {
    email: String,
    password: String,
    password_confirmation: String,
    handle: String,
}

pub async fn handle_signup_email_form_action(
    State(app_state): State<AppState>,
    Form(form): Form<SignupActionFormData>,
) -> Result<SignupActionResponse, TemplateError> {
    if form.password != form.password_confirmation {
        return Ok(SignupActionResponse::Error(SignupTemplate::new(Some(
            "Password and password confirmation do not match".to_string(),
        ))));
    }
    let signup_request = match SignupEmailRequest::new(form.email, form.handle, form.password) {
        Ok(request) => request,
        Err(e) => {
            let error_message = match e {
                SignupEmailRequestError::InvalidEmail(email_error) => match email_error {
                    EmailError::Empty => "Email cannot be empty".to_string(),
                    EmailError::InvalidFormat => "Email format is invalid".to_string(),
                },
                SignupEmailRequestError::InvalidPassword(password_error) => match password_error {
                    PasswordError::Empty => "Password cannot be empty".to_string(),
                    PasswordError::InvalidFormat => "Password format is invalid".to_string(),
                },
                SignupEmailRequestError::InvalidHandle(handle_error) => match handle_error {
                    HandleError::Empty => "Handle cannot be empty".to_string(),
                    HandleError::InvalidFormat => "Handle format is invalid".to_string(),
                    HandleError::InvalidSpecificHandle => "Invalid handle".to_string(),
                },
                SignupEmailRequestError::Unknown(_err) => {
                    return Err(TemplateError::InternalServerError);
                }
            };
            return Ok(SignupActionResponse::Error(SignupTemplate::new(Some(
                error_message,
            ))));
        }
    };

    let (user, _) = match app_state
        .auth_service
        .signup_with_email(signup_request)
        .await
    {
        Ok(user) => user,
        Err(e) => match e {
            SignupEmailError::EmailAlreadyExists(_e) => {
                return Ok(SignupActionResponse::Error(SignupTemplate::new(Some(
                    "Email already exists".to_string(),
                ))));
            }
            SignupEmailError::HandleAlreadyExists(_e) => {
                return Ok(SignupActionResponse::Error(SignupTemplate::new(Some(
                    "Handle already exists".to_string(),
                ))));
            }
            SignupEmailError::Unknown(_err) => {
                return Err(TemplateError::InternalServerError);
            }
        },
    };

    Ok(SignupActionResponse::Success(SignupSuccessTemplate {
        email: user.email,
        handle: user.handle,
    }))
}
