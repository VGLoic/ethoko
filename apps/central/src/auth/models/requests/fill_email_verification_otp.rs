use thiserror::Error;

#[derive(Debug, Error)]
pub enum FillEmailVerificationOtpError {
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}
