use serde::{Deserialize, Serialize};

use crate::newtypes::email::Email;

#[derive(Serialize, Deserialize, Debug)]
pub enum AuthJob {
    FillEmailVerificationOtp(FillEmailVerificationOtpPayload),
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FillEmailVerificationOtpPayload {
    pub user_id: uuid::Uuid,
    pub user_email: Email,
    pub otp_request_id: uuid::Uuid,
}
