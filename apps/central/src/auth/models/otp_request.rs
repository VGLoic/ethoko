#[derive(Debug, Clone, sqlx::Type)]
#[sqlx(rename_all = "snake_case", type_name = "otp_purpose")]
pub enum OtpPurpose {
    EmailVerification,
    PasswordReset,
}

#[derive(Debug, Clone)]
pub enum OtpAssignment {
    Unfilled,
    Filled { otp_hash: [u8; 32] },
}

#[derive(Debug, Clone)]
pub struct OtpRequest {
    #[allow(dead_code)] // Retained as part of the database row.
    pub id: uuid::Uuid,
    #[allow(dead_code)] // Retained as part of the database row.
    pub user_id: uuid::Uuid,
    pub assignment: OtpAssignment,
    #[allow(dead_code)] // Retained as part of the purpose-scoped database row.
    pub purpose: OtpPurpose,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub expires_at: chrono::DateTime<chrono::Utc>,
    pub consumed_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(sqlx::FromRow)]
pub struct OtpRequestRow {
    pub id: uuid::Uuid,
    pub user_id: uuid::Uuid,
    pub otp_hash: Option<[u8; 32]>,
    pub purpose: OtpPurpose,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub expires_at: chrono::DateTime<chrono::Utc>,
    pub consumed_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl From<OtpRequestRow> for OtpRequest {
    /// Infallibly maps a persisted request to its domain model: an absent hash is
    /// Unfilled, and a present hash is Filled.
    fn from(row: OtpRequestRow) -> Self {
        Self {
            id: row.id,
            user_id: row.user_id,
            assignment: match row.otp_hash {
                None => OtpAssignment::Unfilled,
                Some(otp_hash) => OtpAssignment::Filled { otp_hash },
            },
            purpose: row.purpose,
            created_at: row.created_at,
            expires_at: row.expires_at,
            consumed_at: row.consumed_at,
        }
    }
}
