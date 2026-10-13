use crate::{
    auth::models::user::User,
    newtypes::{email::Email, handle::Handle},
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "state")]
pub enum UserResponse {
    #[serde(rename = "pending")]
    Pending {
        email: Email,
        suggested_handle: Option<String>,
        email_verified: bool,
        created_at: chrono::DateTime<chrono::Utc>,
        updated_at: chrono::DateTime<chrono::Utc>,
    },
    #[serde(rename = "registered")]
    Registered {
        email: Email,
        handle: Handle,
        email_verified: bool,
        created_at: chrono::DateTime<chrono::Utc>,
        updated_at: chrono::DateTime<chrono::Utc>,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignupEmailResponse {
    pub email: Email,
    pub email_verified: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl From<User> for UserResponse {
    fn from(user: User) -> Self {
        match user.handle {
            Some(handle) => UserResponse::Registered {
                email: user.email,
                handle,
                email_verified: user.email_verified,
                created_at: user.created_at,
                updated_at: user.updated_at,
            },
            None => UserResponse::Pending {
                email: user.email,
                suggested_handle: user.suggested_handle,
                email_verified: user.email_verified,
                created_at: user.created_at,
                updated_at: user.updated_at,
            },
        }
    }
}

impl From<User> for SignupEmailResponse {
    fn from(user: User) -> Self {
        SignupEmailResponse {
            email: user.email,
            email_verified: user.email_verified,
            created_at: user.created_at,
            updated_at: user.updated_at,
        }
    }
}
