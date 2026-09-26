use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::newtypes::{
    email::{Email, EmailError},
    otp::Otp,
};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpVerifyEmailBody {
    pub email: String,
    pub otp: String,
}

pub struct VerifyEmailRequest {
    pub email: Email,
    pub otp_hash: [u8; 32],
}

#[derive(Debug, Error)]
pub enum VerifyEmailRequestError {
    #[error("Invalid email")]
    InvalidEmail(EmailError),
}

impl VerifyEmailRequest {
    pub fn new(otp: String, email: String) -> Result<Self, VerifyEmailRequestError> {
        let email = Email::new(email.as_str()).map_err(VerifyEmailRequestError::InvalidEmail)?;
        let otp = Otp::from(otp);
        Ok(Self {
            otp_hash: otp.hash(),
            email,
        })
    }
}

#[derive(Debug, Error)]
pub enum VerifyEmailError {
    #[error("User not found")]
    NotFound,
    #[error("Invalid OTP")]
    InvalidOtp,
    #[error("User email is already verified")]
    EmailAlreadyVerified,
    #[error("OTP has expired")]
    OtpExpired,
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}

#[cfg(test)]
mod tests {
    use fake::{Fake, Faker};

    use super::*;

    #[test]
    fn test_valid_verify_email_signup_request() {
        let email = Faker.fake::<Email>();
        let otp = "123456".to_string();

        let result = VerifyEmailRequest::new(otp, email.to_string());
        assert!(result.is_ok());
    }

    #[test]
    fn test_invalid_verify_email_signup_request() {
        let invalid_email = "invalid-email".to_string();
        let otp = "123456".to_string();
        let result = VerifyEmailRequest::new(otp, invalid_email);
        assert!(matches!(
            result,
            Err(VerifyEmailRequestError::InvalidEmail(_))
        ));
    }

    #[test]
    fn test_verify_email_request_otp_hash() {
        let email = Faker.fake::<Email>();
        let otp = "123456".to_string();
        let expected_hash = Otp::from(otp.clone()).hash();
        let request = VerifyEmailRequest::new(otp, email.to_string()).unwrap();
        assert_eq!(request.otp_hash, expected_hash);
    }
}
