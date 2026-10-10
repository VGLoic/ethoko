use oauth2::CsrfToken;
use sha2::Digest;

pub struct AuthorizationUrl {
    pub url: String,
    pub state: OauthState,
}

pub struct OauthState(CsrfToken);

impl OauthState {
    /// Creates a new `OauthState` wrapping the given CSRF token string.
    pub fn new(csrf_token: &str) -> Self {
        OauthState(CsrfToken::new(csrf_token.to_string()))
    }

    /// Returns the secret value of the underlying CSRF token.
    ///
    /// # Warning
    /// This exposes the secret value of the CSRF token and should be handled with care.
    pub fn secret(&self) -> &str {
        self.0.secret()
    }

    /// Returns the SHA-256 hash of the secret value of the underlying CSRF token.
    pub fn hash(&self) -> [u8; 32] {
        sha2::Sha256::digest(self.0.secret().as_bytes()).into()
    }
}

impl From<CsrfToken> for OauthState {
    fn from(csrf_token: CsrfToken) -> Self {
        OauthState(csrf_token)
    }
}
