#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct AuthCredential {
    pub id: uuid::Uuid,
    pub user_id: uuid::Uuid,
    pub password_hash: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}
