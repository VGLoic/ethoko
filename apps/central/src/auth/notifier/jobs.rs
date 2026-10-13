use serde::{Deserialize, Serialize};

use crate::{
    auth::models::user::User,
    newtypes::email::Email,
};

#[derive(Serialize, Deserialize, Debug)]
pub enum AuthJob {
    SendEmailVerificationOtp(SendEmailVerificationOtpPayload),
}

#[derive(Serialize, Deserialize, Debug)]
pub struct SendEmailVerificationOtpPayload {
    pub user_id: uuid::Uuid,
    pub user_email: Email,
}

impl SendEmailVerificationOtpPayload {
    pub fn new(user: &User) -> Self {
        Self {
            user_id: user.id,
            user_email: user.email.to_owned(),
        }
    }
}
