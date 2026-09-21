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
                    ApiError::Unauthorized("Authorization header missing".to_string())
                }
                TypedHeaderRejectionReason::Error(err) => ApiError::Unauthorized(err.to_string()),
                _other => ApiError::Unauthorized(
                    "Unknown error while extracting authorization header".to_string(),
                ),
            })?;

        let opaque_session_token_value = OpaqueTokenValue::new(bearer.token().to_string())
            .map_err(|e| ApiError::Unauthorized(e.to_string()))?;
        let session_token_hash = opaque_session_token_value.hash();

        let user = state
            .auth_service
            .get_user_by_session_token(&session_token_hash)
            .await
            .map_err(|e| ApiError::Unauthorized(e.to_string()))?;

        Ok(AuthenticatedUser {
            user,
            session_token_hash,
        })
    }
}
