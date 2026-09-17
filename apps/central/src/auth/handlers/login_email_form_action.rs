use crate::{
    auth::{
        authenticated_user::SESSION_COOKIE_NAME,
        handlers::{html_templates::HtmlTemplate, login_email_form_render::LoginTemplate},
        models::opaque_token::OpaqueTokenValue,
        requests::login_email::{LoginEmailError, LoginEmailRequest, LoginEmailRequestError},
    },
    newtypes::{email::EmailError, password::PasswordError},
};
use axum::{
    extract::{Form, State},
    http::header::SET_COOKIE,
    response::{IntoResponse, Redirect},
};
use serde::Deserialize;
use tracing::error;

use super::html_templates::TemplateError;
use crate::router::AppState;

pub enum LoginActionResponse {
    Success(OpaqueTokenValue),
    Error(LoginTemplate),
}

impl IntoResponse for LoginActionResponse {
    fn into_response(self) -> axum::response::Response {
        match self {
            LoginActionResponse::Success(opaque_token_value) => {
                let cookie = format!(
                    "{SESSION_COOKIE_NAME}={}; SameSite=Strict; HttpOnly; Path=/; Secure",
                    opaque_token_value.as_str()
                );
                let parsed_cookie = match cookie.parse() {
                    Ok(cookie) => cookie,
                    Err(_) => return TemplateError::InternalServerError.into_response(),
                };
                let mut response = Redirect::to("/auth/pages/me").into_response();
                response.headers_mut().insert(SET_COOKIE, parsed_cookie);
                response
            }
            LoginActionResponse::Error(template) => HtmlTemplate::new(template).into_response(),
        }
    }
}

#[derive(Deserialize)]
pub struct LoginActionFormData {
    email: String,
    password: String,
}

pub async fn handle_login_email_email_form_action(
    State(app_state): State<AppState>,
    Form(form): Form<LoginActionFormData>,
) -> Result<LoginActionResponse, TemplateError> {
    let login_request = match LoginEmailRequest::new(form.email, form.password) {
        Ok(request) => request,
        Err(e) => {
            let error_message = match e {
                LoginEmailRequestError::InvalidEmail(email_error) => match email_error {
                    EmailError::Empty => "Email cannot be empty".to_string(),
                    EmailError::InvalidFormat => "Email format is invalid".to_string(),
                },
                LoginEmailRequestError::InvalidPassword(password_error) => match password_error {
                    PasswordError::Empty => "Password cannot be empty".to_string(),
                    PasswordError::InvalidFormat => "Password format is invalid".to_string(),
                },
            };
            return Ok(LoginActionResponse::Error(LoginTemplate::new(Some(
                error_message,
            ))));
        }
    };

    // REMIND ME
    let (_user, opaque_token_value) =
        match app_state.auth_service.login_with_email(login_request).await {
            Ok((user, opaque_token_value)) => (user, opaque_token_value),
            Err(e) => match e {
                LoginEmailError::InvalidCredentials => {
                    error!("Login error: {:?}", e);
                    return Ok(LoginActionResponse::Error(LoginTemplate::new(Some(
                        "Invalid email or password".to_string(),
                    ))));
                }
                LoginEmailError::UserNotFound => {
                    error!("Login error: {:?}", e);
                    return Ok(LoginActionResponse::Error(LoginTemplate::new(Some(
                        "Invalid email or password".to_string(),
                    ))));
                }
                LoginEmailError::Unknown(_err) => {
                    return Err(TemplateError::InternalServerError);
                }
            },
        };

    Ok(LoginActionResponse::Success(opaque_token_value))
}
