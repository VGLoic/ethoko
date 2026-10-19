use crate::newtypes::{email::Email, otp::Otp};
use resend_rs::{
    Resend, types::CreateEmailBaseOptions, types::EmailTemplate as ResendEmailTemplate,
};
use std::{collections::HashMap, path::PathBuf};
use tokio::io::AsyncWriteExt;
use tracing::debug;

#[derive(Debug, Clone)]
pub enum EmailTemplate {
    EmailVerificationCode(EmailVerificationCodePayload),
}

#[derive(Debug, Clone)]
pub struct EmailVerificationCodePayload {
    pub email: Email,
    pub otp: Otp,
}

impl From<EmailVerificationCodePayload> for EmailTemplate {
    fn from(value: EmailVerificationCodePayload) -> Self {
        EmailTemplate::EmailVerificationCode(value)
    }
}

impl EmailVerificationCodePayload {
    pub fn new(email: Email, otp: Otp) -> Self {
        Self { email, otp }
    }

    fn verification_url(&self, web_app_url: &str) -> Result<String, anyhow::Error> {
        let mut url = reqwest::Url::parse(&format!(
            "{}/verify-email",
            web_app_url.trim_end_matches('/')
        ))
        .map_err(|_| anyhow::anyhow!("Invalid web application URL for email verification"))?;
        url.query_pairs_mut()
            .append_pair("email", self.email.as_str())
            .append_pair("otp", self.otp.show());
        Ok(url.into())
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

#[async_trait::async_trait]
impl EmailService for Box<dyn EmailService> {
    async fn send_email(&self, email: Email, template: EmailTemplate) -> Result<(), anyhow::Error> {
        self.as_ref().send_email(email, template).await
    }
}

/// Development-only message capture, separate from operational tracing.
pub struct LocalEmailService {
    web_app_url: String,
    directory: PathBuf,
}

impl LocalEmailService {
    pub fn new(web_app_url: String, directory: PathBuf) -> Self {
        Self {
            web_app_url,
            directory,
        }
    }
}

#[async_trait::async_trait]
impl EmailService for LocalEmailService {
    async fn send_email(&self, email: Email, template: EmailTemplate) -> Result<(), anyhow::Error> {
        let EmailTemplate::EmailVerificationCode(payload) = template;
        let message = serde_json::json!({
            "recipient": email,
            "kind": "email-verification-code",
            "delivered_at": chrono::Utc::now(),
            "verification_url": payload.verification_url(&self.web_app_url)?,
        });
        let mut directory = tokio::fs::DirBuilder::new();
        directory.recursive(true);
        #[cfg(unix)]
        directory.mode(0o700);
        directory.create(&self.directory).await?;
        let id = uuid::Uuid::new_v4();
        let temporary = self.directory.join(format!("{id}.tmp"));
        let destination = self.directory.join(format!("{id}.json"));
        let mut options = tokio::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options.open(&temporary).await?;
        file.write_all(&serde_json::to_vec_pretty(&message)?)
            .await?;
        file.sync_all().await?;
        drop(file);
        tokio::fs::rename(temporary, destination).await?;
        debug!(
            event = "externalcom.email.send_succeeded",
            provider = "local-capture",
            template = "email-verification-code",
            "Captured email locally"
        );
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
    verification_url: String,
}

pub struct ResendEmailService {
    web_app_url: String,
    client: Resend,
}

impl ResendEmailService {
    pub fn new(web_app_url: String, api_key: String) -> Self {
        let client = Resend::new(&api_key);
        Self {
            web_app_url,
            client,
        }
    }

    fn map_to_resend_template(
        &self,
        template: EmailTemplate,
    ) -> Result<RsEmailVerificationTemplate, anyhow::Error> {
        match template {
            EmailTemplate::EmailVerificationCode(payload) => {
                let verification_url = payload.verification_url(&self.web_app_url)?;
                Ok(RsEmailVerificationTemplate::ResendEmailVerificationCode(
                    RsEmailVerificationCodeVariables {
                        email: payload.email,
                        verification_url,
                    },
                ))
            }
        }
    }
}

#[async_trait::async_trait]
impl EmailService for ResendEmailService {
    async fn send_email(&self, email: Email, template: EmailTemplate) -> Result<(), anyhow::Error> {
        let resend_template = self.map_to_resend_template(template)?;

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
            event = "externalcom.email.send_succeeded",
            provider = "resend",
            template = resend_template.template_id(),
            "Sent email via provider"
        );
        let _ = email;
        Ok(())
    }
}
