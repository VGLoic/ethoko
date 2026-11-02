use serde::{Deserialize, Serialize};

use crate::newtypes::email::Email;

#[derive(Serialize, Deserialize, Debug)]
pub enum AuthJob {
    // Retained jobs from before linked request creation remain processable.
    SendEmailVerificationOtp(SendEmailVerificationOtpPayload),
    FillEmailVerificationOtp(FillEmailVerificationOtpPayload),
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FillEmailVerificationOtpPayload {
    pub user_id: uuid::Uuid,
    pub user_email: Email,
    pub otp_request_id: uuid::Uuid,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct SendEmailVerificationOtpPayload {
    pub user_id: uuid::Uuid,
    pub user_email: Email,
}
