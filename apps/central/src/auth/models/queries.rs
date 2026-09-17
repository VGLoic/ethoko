use thiserror::Error;

#[derive(Error, Debug)]
pub enum GetUserByEmailError {
    #[error("User not found")]
    NotFound,
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}

#[derive(Error, Debug)]
pub enum GetUserBySessionTokenError {
    #[error("User not found")]
    UserNotFound,
    #[error("Token not found")]
    TokenNotFound,
    #[error("Token revoked")]
    TokenRevoked,
    #[error("Token expired")]
    TokenExpired,
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}
