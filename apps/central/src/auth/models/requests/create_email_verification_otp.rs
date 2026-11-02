use thiserror::Error;

#[derive(Debug, Error)]
pub enum CreateEmailVerificationOtpError {
    #[error("User not found")]
    NotFound,
    #[error("User email is already verified")]
    EmailAlreadyVerified,
    #[error("Cooldown period has not elapsed yet for requesting a new verification code")]
    CooldownNotElapsed,
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}
