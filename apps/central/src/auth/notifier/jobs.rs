use serde::{Deserialize, Serialize};

use crate::{auth::models::user::User, newtypes::email::Email};

#[derive(Serialize, Deserialize, Debug)]
pub enum AuthJob {
    SendEmailVerificationOtp(SendEmailVerificationOtpPayload),
    SendPasswordReset(SendPasswordResetPayload),
}

#[derive(Serialize, Deserialize, Debug)]
pub struct SendPasswordResetPayload {
    pub email: Email,
    pub reset_url: String,
    pub expires_at: chrono::DateTime<chrono::Utc>,
}

impl SendPasswordResetPayload {
    /// Prepares a deliverable link for an issued token without changing its expiry.
    pub fn new(
        email: Email,
        token: &str,
        expires_at: chrono::DateTime<chrono::Utc>,
        web_app_url: &str,
    ) -> Result<Self, anyhow::Error> {
        let mut link = reqwest::Url::parse(web_app_url)?.join("/reset-password")?;
        link.query_pairs_mut().append_pair("token", token);
        Ok(Self {
            email,
            reset_url: link.into(),
            expires_at,
        })
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub struct SendEmailVerificationOtpPayload {
    pub user_id: uuid::Uuid,
    pub user_email: Email,
}

impl SendEmailVerificationOtpPayload {
    pub fn new(user: &User) -> Self {
        Self {
            user_id: user.id(),
            user_email: user.email().to_owned(),
        }
    }
}
