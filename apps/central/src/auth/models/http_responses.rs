use crate::{
    auth::models::user::User,
    newtypes::{email::Email, handle::Handle},
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "state")]
pub enum UserResponse {
    #[serde(rename = "pending", rename_all = "camelCase")]
    Pending {
        email: Email,
        suggested_handle: Option<String>,
        email_verified: bool,
        created_at: chrono::DateTime<chrono::Utc>,
        updated_at: chrono::DateTime<chrono::Utc>,
    },
    #[serde(rename = "registered", rename_all = "camelCase")]
    Registered {
        email: Email,
        handle: Handle,
        email_verified: bool,
        created_at: chrono::DateTime<chrono::Utc>,
        updated_at: chrono::DateTime<chrono::Utc>,
    },
}

impl From<User> for UserResponse {
    fn from(user: User) -> Self {
        match user {
            User::Pending(user) => UserResponse::Pending {
                email: user.email,
                suggested_handle: user.suggested_handle,
                email_verified: user.email_verified,
                created_at: user.created_at,
                updated_at: user.updated_at,
            },
            User::Registered(user) => UserResponse::Registered {
                email: user.email,
                handle: user.handle,
                email_verified: user.email_verified,
                created_at: user.created_at,
                updated_at: user.updated_at,
            },
        }
    }
}
