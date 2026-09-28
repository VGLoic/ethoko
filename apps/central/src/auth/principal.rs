use axum::RequestPartsExt;
use axum::extract::FromRequestParts;
use axum_extra::{
    TypedHeader, headers,
    typed_header::{TypedHeaderRejection, TypedHeaderRejectionReason},
};

use crate::{
    auth::models::{opaque_token::OpaqueTokenValue, user::User},
    router::{ApiError, AppState},
};

const USER_AUTHORIZATION_HEADER_NAME: &str = "x-ethoko-user-authorization";

pub struct CentralUiBff;

pub struct CentralUiBffWithUser {
    pub user: User,
    pub session_token_hash: [u8; 32],
}

impl FromRequestParts<AppState> for CentralUiBff {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let secret = extract_bff_bearer_token(parts).await?;

        if secret != state.central_ui_bff_shared_secret.as_str() {
            return Err(ApiError::Unauthorized(anyhow::anyhow!(
                "Invalid Central UI BFF shared secret"
            )));
        }

        Ok(Self)
    }
}

impl FromRequestParts<AppState> for CentralUiBffWithUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        CentralUiBff::from_request_parts(parts, state).await?;

        let user_session_token = extract_user_session_bearer_token(parts)?;
        let opaque_session_token_value =
            OpaqueTokenValue::new(user_session_token).map_err(|e| {
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

        Ok(Self {
            user,
            session_token_hash,
        })
    }
}

async fn extract_bff_bearer_token(
    parts: &mut axum::http::request::Parts,
) -> Result<String, ApiError> {
    let TypedHeader(headers::Authorization(bearer)) = parts
        .extract::<TypedHeader<headers::Authorization<headers::authorization::Bearer>>>()
        .await
        .map_err(map_authorization_header_rejection)?;

    Ok(bearer.token().to_string())
}

fn extract_user_session_bearer_token(
    parts: &axum::http::request::Parts,
) -> Result<String, ApiError> {
    let header_value = parts
        .headers
        .get(USER_AUTHORIZATION_HEADER_NAME)
        .ok_or_else(|| {
            ApiError::Unauthorized(anyhow::anyhow!(
                "X-Ethoko-User-Authorization header missing"
            ))
        })?;

    let header_value = header_value.to_str().map_err(|err| {
        ApiError::Unauthorized(
            anyhow::Error::new(err)
                .context("X-Ethoko-User-Authorization header is not valid ASCII"),
        )
    })?;

    let token = header_value.strip_prefix("Bearer ").ok_or_else(|| {
        ApiError::Unauthorized(anyhow::anyhow!(
            "X-Ethoko-User-Authorization header is not a Bearer token"
        ))
    })?;

    Ok(token.to_string())
}

fn map_authorization_header_rejection(rejection: TypedHeaderRejection) -> ApiError {
    match rejection.reason() {
        TypedHeaderRejectionReason::Missing => {
            ApiError::Unauthorized(anyhow::anyhow!("Authorization header missing"))
        }
        TypedHeaderRejectionReason::Error(err) => ApiError::Unauthorized(
            anyhow::anyhow!("{err}").context("Error while extracting authorization header"),
        ),
        _other => ApiError::Unauthorized(anyhow::anyhow!(
            "Unknown error while extracting authorization header"
        )),
    }
}
