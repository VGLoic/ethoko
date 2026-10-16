#[derive(Debug, Clone, sqlx::Type)]
#[sqlx(rename_all = "snake_case", type_name = "otp_purpose")]
pub enum OtpPurpose {
    EmailVerification,
    PasswordReset,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct OtpRequest {
    #[allow(dead_code)] // Retained as part of the database row.
    pub id: uuid::Uuid,
    #[allow(dead_code)] // Retained as part of the database row.
    pub user_id: uuid::Uuid,
    pub otp_hash: [u8; 32],
    pub purpose: OtpPurpose,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub expires_at: chrono::DateTime<chrono::Utc>,
}
