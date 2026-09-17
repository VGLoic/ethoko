use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use fake::rand;
use sha2::Digest;

#[derive(Debug, Clone, sqlx::Type)]
#[sqlx(rename_all = "snake_case", type_name = "opaque_token_kind")]
pub enum OpaqueTokenKind {
    Session,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct OpaqueToken {
    pub id: uuid::Uuid,
    pub user_id: uuid::Uuid,
    pub kind: OpaqueTokenKind,
    pub token_hash: [u8; 32],
    pub scopes: Vec<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub expires_at: chrono::DateTime<chrono::Utc>,
    pub revoked_at: Option<chrono::DateTime<chrono::Utc>>,
    pub last_used_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone)]
pub enum OpaqueTokenValue {
    Session(String),
}

impl OpaqueTokenValue {
    pub fn new(value: String) -> Result<Self, anyhow::Error> {
        if value.starts_with("etks_") {
            Ok(OpaqueTokenValue::Session(value))
        } else {
            Err(anyhow::anyhow!("Invalid opaque token format"))
        }
    }
    /// Returns the token as a string slice.
    ///
    /// # Examples
    ///
    /// ```
    /// let token = OpaqueTokenValue::generate_session_token();
    /// println!("Token: {}", token.as_str());
    /// ```
    pub fn as_str(&self) -> &str {
        match self {
            OpaqueTokenValue::Session(token) => token,
        }
    }

    /// Generates a new session token.
    /// # Examples
    ///
    /// ```
    /// let token = OpaqueTokenValue::generate_session_token();
    /// println!("Token: {}", token.as_str());
    /// ```
    pub fn generate_session_token() -> Self {
        let token_bytes: [u8; 32] = rand::random();
        let token = format!("etks_{}", URL_SAFE_NO_PAD.encode(token_bytes));
        OpaqueTokenValue::Session(token)
    }

    /// Returns the SHA-256 hash of the token as a 32-byte array.
    ///
    /// # Examples
    ///
    /// ```
    /// let token = OpaqueTokenValue::generate_session_token();
    /// let hash = token.hash();
    /// println!("Token hash: {:?}", hash);
    /// ```
    pub fn hash(&self) -> [u8; 32] {
        match self {
            OpaqueTokenValue::Session(token) => sha2::Sha256::digest(token.as_bytes()).into(),
        }
    }
}

pub struct OpaqueTokenCreatePayload {
    pub token_hash: [u8; 32],
    pub scopes: Vec<String>,
    pub kind: OpaqueTokenKind,
    pub expires_at: chrono::DateTime<chrono::Utc>,
}
impl OpaqueTokenCreatePayload {
    pub fn new(token: &OpaqueTokenValue) -> Self {
        let kind = match token {
            OpaqueTokenValue::Session(_) => OpaqueTokenKind::Session,
        };
        Self {
            token_hash: token.hash(),
            scopes: vec![],
            kind,
            expires_at: chrono::Utc::now() + chrono::Duration::hours(1),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_session_token() {
        let token = OpaqueTokenValue::generate_session_token();
        assert!(token.as_str().starts_with("etks_"));
    }

    #[test]
    fn test_generate_session_token_payload() {
        let token = OpaqueTokenValue::generate_session_token();
        let payload = OpaqueTokenCreatePayload::new(&token);
        assert!(payload.token_hash.len() == 32);
        assert_eq!(payload.token_hash, token.hash());
    }

    #[test]
    fn test_token_hash() {
        let token = OpaqueTokenValue::generate_session_token();
        let hash = token.hash();
        assert_eq!(hash.len(), 32);
    }

    #[test]
    fn test_token_new() {
        let token_str = "etks_abcdefghijklmnopqrstuvwxyz123456";
        let token = OpaqueTokenValue::new(token_str.to_string()).unwrap();
        assert!(matches!(token, OpaqueTokenValue::Session(_)));
    }

    #[test]
    fn test_token_new_invalid() {
        let token_str = "invalid_token_format";
        let result = OpaqueTokenValue::new(token_str.to_string());
        assert!(result.is_err());
    }
}
