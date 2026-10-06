#[derive(Debug, Clone, sqlx::FromRow)]
pub struct OauthTransaction {
    pub id: uuid::Uuid,
    #[allow(dead_code)]
    pub state_hash: [u8; 32],
    #[allow(dead_code)]
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub expires_at: chrono::DateTime<chrono::Utc>,
}
