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
                    ApiError::Unauthorized(anyhow::anyhow!("missing_authorization_header"))
                }
                TypedHeaderRejectionReason::Error(err) => ApiError::Unauthorized(
                    anyhow::anyhow!("authorization_header_rejected")
                        .context(err.to_string()),
                ),
                _other => ApiError::Unauthorized(anyhow::anyhow!(
                    "unknown_authorization_header_error"
                )),
            })?;

        let opaque_session_token_value = OpaqueTokenValue::new(bearer.token().to_string())
            .map_err(|e| ApiError::Unauthorized(e.context("invalid_session_token")))?;
        let session_token_hash = opaque_session_token_value.hash();

        let user = state
            .auth_service
            .get_user_by_session_token(&session_token_hash)
            .await
            .map_err(|e| {
                ApiError::Unauthorized(anyhow::Error::new(e).context("session_token_rejected"))
            })?;

        Ok(AuthenticatedUser {
            user,
            session_token_hash,
        })
    }
}
