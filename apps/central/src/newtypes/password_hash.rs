#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PasswordHash(String);

#[derive(Debug)]
pub enum PasswordHashError {
    InvalidFormat,
}

impl PasswordHash {
    pub fn new(hash: &str) -> Result<Self, PasswordHashError> {
        match argon2::PasswordHash::new(hash) {
            Ok(v) => Ok(Self(v.to_string())),
            Err(_) => Err(PasswordHashError::InvalidFormat),
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<argon2::PasswordHash<'_>> for PasswordHash {
    fn from(hash: argon2::PasswordHash<'_>) -> Self {
        Self(hash.to_string())
    }
}
