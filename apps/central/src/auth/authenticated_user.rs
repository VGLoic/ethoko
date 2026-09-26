use axum::RequestPartsExt;
use axum::extract::FromRequestParts;
use axum_extra::{TypedHeader, headers, typed_header::TypedHeaderRejectionReason};

use crate::{
    auth::models::{opaque_token::OpaqueTokenValue, user::User},
    router::{ApiError, AppState},
};

pub struct AuthenticatedUser {
    pub user: User,
    pub session_token_hash: [u8; 32],
}

impl FromRequestParts<AppState> for AuthenticatedUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let TypedHeader(headers::Authorization(bearer)) = parts
            .extract::<TypedHeader<headers::Authorization<headers::authorization::Bearer>>>()
            .await
            .map_err(|e| match e.reason() {
                TypedHeaderRejectionReason::Missing => {
                    ApiError::Unauthorized(anyhow::anyhow!("Authorization header missing"))
                }
                TypedHeaderRejectionReason::Error(err) => ApiError::Unauthorized(
                    anyhow::anyhow!("{err}").context("Error while extracting authorization header"),
                ),
                _other => ApiError::Unauthorized(anyhow::anyhow!(
                    "Unknown error while extracting authorization header"
                )),
            })?;

        let opaque_session_token_value = OpaqueTokenValue::new(bearer.token().to_string())
            .map_err(|e| {
                ApiError::Unauthorized(e.context("Error while creating opaque session token value"))
            })?;
        let session_token_hash = opaque_session_token_value.hash();

        let user = state
            .auth_service
            .get_user_by_session_token(&session_token_hash)
            .await
            .map_err(|e| {
                ApiError::Unauthorized(
                    anyhow::Error::new(e).context("Error while fetching user by session token"),
                )
            })?;

        Ok(AuthenticatedUser {
            user,
            session_token_hash,
        })
    }
}
