use thiserror::Error;

#[derive(Debug, Error)]
pub enum LogoutError {
    #[error("Token not found")]
    TokenNotFound,
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}
