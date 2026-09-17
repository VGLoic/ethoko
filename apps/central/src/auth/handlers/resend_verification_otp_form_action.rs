use crate::auth::{
    handlers::html_templates::HtmlTemplate,
    models::requests::resend_verification_otp::{
        ResendVerificationOtpError, ResendVerificationOtpRequest,
    },
};
use askama::Template;
use axum::{
    extract::{Form, State},
    response::IntoResponse,
};
use serde::Deserialize;
use tracing::error;

use super::html_templates::TemplateError;
use crate::{newtypes::email::Email, router::AppState};

#[derive(Template)]
#[template(path = "resend_verification_otp_success.html")]
pub struct ResendVerificationOtpSuccessTemplate {
    email: Email,
}

pub enum ResendVerificationOtpActionError {
    EmailAlreadyVerified,
    CooldownNotElapsed,
}
#[derive(Template)]
#[template(path = "resend_verification_otp_error.html")]
pub struct ResendVerificationOtpErrorTemplate {
    email: Email,
    err: ResendVerificationOtpActionError,
}

pub enum ResendVerificationOtpActionResponse {
    Success(ResendVerificationOtpSuccessTemplate),
    Error(ResendVerificationOtpErrorTemplate),
}

impl IntoResponse for ResendVerificationOtpActionResponse {
    fn into_response(self) -> axum::response::Response {
        match self {
            ResendVerificationOtpActionResponse::Success(template) => {
                HtmlTemplate::new(template).into_response()
            }
            ResendVerificationOtpActionResponse::Error(template) => {
                HtmlTemplate::new(template).into_response()
            }
        }
    }
}

#[derive(Deserialize)]
pub struct ResendVerificationOtpFormData {
    pub email: String,
}
pub async fn handle_resend_verification_otp_form_action(
    State(state): State<AppState>,
    Form(form): Form<ResendVerificationOtpFormData>,
) -> Result<ResendVerificationOtpActionResponse, TemplateError> {
    let request = ResendVerificationOtpRequest::new(form.email).map_err(|e| {
        error!("Invalid resend verification OTP request: {}", e);
        TemplateError::InternalServerError
    })?;

    let email = request.email.clone();
    if let Err(e) = state.auth_service.resend_verification_otp(request).await {
        match e {
            ResendVerificationOtpError::UserNotFound => {
                return Err(TemplateError::NotFound);
            }
            ResendVerificationOtpError::UserAlreadyVerified => {
                return Ok(ResendVerificationOtpActionResponse::Error(
                    ResendVerificationOtpErrorTemplate {
                        email,
                        err: ResendVerificationOtpActionError::EmailAlreadyVerified,
                    },
                ));
            }
            ResendVerificationOtpError::CooldownNotElapsed => {
                return Ok(ResendVerificationOtpActionResponse::Error(
                    ResendVerificationOtpErrorTemplate {
                        email,
                        err: ResendVerificationOtpActionError::CooldownNotElapsed,
                    },
                ));
            }
            ResendVerificationOtpError::Unknown(err) => {
                error!("Error resending verification OTP: {}", err);
                return Err(TemplateError::InternalServerError);
            }
        }
    }

    let template = ResendVerificationOtpSuccessTemplate { email };
    Ok(ResendVerificationOtpActionResponse::Success(template))
}
