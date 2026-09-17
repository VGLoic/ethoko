use crate::newtypes::{email::Email, handle::Handle, otp::Otp};
use resend_rs::{
    Resend, types::CreateEmailBaseOptions, types::EmailTemplate as ResendEmailTemplate,
};
use std::collections::HashMap;
use tracing::{debug, info};

#[derive(Debug, Clone)]
pub enum EmailTemplate {
    EmailVerificationCode(EmailVerificationCodePayload),
}

#[derive(Debug, Clone)]
pub struct EmailVerificationCodePayload {
    pub email: Email,
    pub handle: Handle,
    pub otp: Otp,
}

impl From<EmailVerificationCodePayload> for EmailTemplate {
    fn from(value: EmailVerificationCodePayload) -> Self {
        EmailTemplate::EmailVerificationCode(value)
    }
}

impl EmailVerificationCodePayload {
    pub fn new(email: Email, handle: Handle, otp: Otp) -> Self {
        Self { email, handle, otp }
    }
}

/// Email service trait for email operations
#[async_trait::async_trait]
pub trait EmailService: Send + Sync + 'static {
    /// Send an email to a target email with the input content
    /// # Arguments
    /// * `email` email to send to
    /// * `template` template to send
    /// # Errors
    /// * `anyhow::Error` for any errors that may occur during the process
    async fn send_email(&self, email: Email, template: EmailTemplate) -> Result<(), anyhow::Error>;
}

pub struct DummyEmailSender;

#[async_trait::async_trait]
impl EmailService for DummyEmailSender {
    async fn send_email(&self, email: Email, template: EmailTemplate) -> Result<(), anyhow::Error> {
        info!("Sending email to: {}, content: {:?}", email, template);
        Ok(())
    }
}

enum RsEmailVerificationTemplate {
    ResendEmailVerificationCode(RsEmailVerificationCodeVariables),
}

impl RsEmailVerificationTemplate {
    fn template_id(&self) -> &'static str {
        match self {
            RsEmailVerificationTemplate::ResendEmailVerificationCode(_) => {
                "email-verification-code"
            }
        }
    }

    fn serialize_variables(&self) -> HashMap<String, serde_json::Value> {
        match self {
            RsEmailVerificationTemplate::ResendEmailVerificationCode(vars) => {
                let mut map = HashMap::new();
                map.insert("email".to_string(), serde_json::json!(vars.email));
                map.insert("handle".to_string(), serde_json::json!(vars.handle));
                map.insert(
                    "verification_url".to_string(),
                    serde_json::json!(vars.verification_url),
                );
                map
            }
        }
    }
}

#[derive(Debug)]
struct RsEmailVerificationCodeVariables {
    email: Email,
    handle: Handle,
    verification_url: String,
}

pub struct ResendEmailService {
    app_url: String,
    client: Resend,
}

impl ResendEmailService {
    pub fn new(app_url: String, api_key: String) -> Self {
        let client = Resend::new(&api_key);
        Self { app_url, client }
    }

    fn map_to_resend_template(&self, template: EmailTemplate) -> RsEmailVerificationTemplate {
        match template {
            EmailTemplate::EmailVerificationCode(payload) => {
                let verification_url = format!(
                    "{}/auth/pages/verify-email?email={}&otp={}",
                    self.app_url,
                    payload.email,
                    payload.otp.show()
                );
                RsEmailVerificationTemplate::ResendEmailVerificationCode(
                    RsEmailVerificationCodeVariables {
                        email: payload.email,
                        handle: payload.handle,
                        verification_url,
                    },
                )
            }
        }
    }
}

#[async_trait::async_trait]
impl EmailService for ResendEmailService {
    async fn send_email(&self, email: Email, template: EmailTemplate) -> Result<(), anyhow::Error> {
        let resend_template = self.map_to_resend_template(template);

        let variables = resend_template.serialize_variables();
        let template =
            ResendEmailTemplate::new(resend_template.template_id()).with_variables(variables);
        let opts = CreateEmailBaseOptions::new(
            "Central <central@ethoko.com>",
            vec![email.to_string()],
            "[Ethoko Central] Please verify your email address",
        )
        .with_template(template);

        let _email = self
            .client
            .emails
            .send(opts)
            .await
            .map_err(|e| anyhow::Error::new(e).context("Failed to send email"))?;

        debug!(
            "Sending email via ResendClient to: {}, template: {:?}",
            email,
            resend_template.template_id()
        );
        Ok(())
    }
}
