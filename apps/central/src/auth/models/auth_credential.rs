use sqlx::Row;

use crate::newtypes::{github_id::GithubId, password_hash::PasswordHash};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthCredential {
    pub id: uuid::Uuid,
    pub user_id: uuid::Uuid,
    pub payload: AuthCredentialPayload,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthCredentialPayload {
    /// Contains the password hash obtained using a secure hashing algorithm. See src/auth/password_hasher.rs for details.
    PasswordHash { hash: PasswordHash },
    /// Contains the Github ID of the user.
    GithubOauth { github_id: GithubId },
}

impl AuthCredentialPayload {
    /// Map a password hash to an `AuthCredentialPayload::PasswordHash` serialized JSON form.
    pub fn from_password_hash(hash: PasswordHash) -> serde_json::Value {
        Self::PasswordHash { hash }.serialize_to_json()
    }

    pub fn from_github_oauth(github_id: GithubId) -> serde_json::Value {
        Self::GithubOauth { github_id }.serialize_to_json()
    }

    fn serialize_to_json(&self) -> serde_json::Value {
        match self {
            AuthCredentialPayload::PasswordHash { hash } => {
                serde_json::json!({
                    "type": "password_hash",
                    "hash": hash.as_str(),
                })
            }
            AuthCredentialPayload::GithubOauth { github_id } => {
                serde_json::json!({
                    "type": "github_oauth",
                    "github_id": github_id.as_u64(),
                })
            }
        }
    }
}

/// Implementation of the `sqlx::FromRow` trait for `AuthCredential`. This allows `AuthCredential` to be constructed from a database row.
/// The AuthCredentialPayload is stored as a JSON column in the database.
/// - AuthCredentialPayload::PasswordHash -> { type: "password_hash", hash: "<hash_value>" }
/// - AuthCredentialPayload::GithubOauth -> { type: "github_oauth", github_id: "<github_id>" }
impl sqlx::FromRow<'_, sqlx::postgres::PgRow> for AuthCredential {
    fn from_row(row: &sqlx::postgres::PgRow) -> Result<Self, sqlx::Error> {
        let id: uuid::Uuid = row.try_get("id")?;
        let user_id: uuid::Uuid = row.try_get("user_id")?;
        let payload: AuthCredentialPayload = {
            let payload_json: serde_json::Value = row.try_get("payload")?;
            match payload_json.get("type").and_then(|t| t.as_str()) {
                Some("password_hash") => AuthCredentialPayload::PasswordHash {
                    hash: PasswordHash::new(
                        payload_json
                            .get("hash")
                            .and_then(|h| h.as_str())
                            .ok_or(sqlx::Error::ColumnNotFound("Invalid password hash".into()))?,
                    )
                    .map_err(|_| sqlx::Error::ColumnNotFound("Invalid password hash".into()))?,
                },
                Some("github_oauth") => AuthCredentialPayload::GithubOauth {
                    github_id: payload_json
                        .get("github_id")
                        .and_then(|g| g.as_u64())
                        .map(GithubId::new)
                        .ok_or(sqlx::Error::ColumnNotFound("Invalid github_id".into()))?,
                },
                _ => return Err(sqlx::Error::ColumnNotFound("Invalid payload type".into())),
            }
        };
        let created_at: chrono::DateTime<chrono::Utc> = row.try_get("created_at")?;
        let updated_at: chrono::DateTime<chrono::Utc> = row.try_get("updated_at")?;

        Ok(AuthCredential {
            id,
            user_id,
            payload,
            created_at,
            updated_at,
        })
    }
}
