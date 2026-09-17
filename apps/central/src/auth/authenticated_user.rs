use axum::RequestPartsExt;
use axum::extract::FromRequestParts;
use axum::response::IntoResponse;
use axum_extra::{TypedHeader, headers, typed_header::TypedHeaderRejectionReason};
use tracing::error;

use crate::{
    auth::models::{opaque_token::OpaqueTokenValue, user::User},
    router::{ApiError, AppState},
};

pub const SESSION_COOKIE_NAME: &str = "ETHOKO_SESSION_TOKEN";
pub const COOKIE_HEADER_NAME: &str = "cookie";

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

pub struct AuthenticatedUserPages {
    pub user: User,
    pub session_token_hash: [u8; 32],
}

pub struct AuthRedirect;

impl IntoResponse for AuthRedirect {
    fn into_response(self) -> axum::response::Response {
        let mut response = axum::response::Redirect::to("/auth/pages/login").into_response();
        let cleanup_cookie_value = format!("{SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; Secure");
        let cleanup_cookie = match axum::http::HeaderValue::from_str(&cleanup_cookie_value) {
            Ok(value) => value,
            Err(e) => {
                error!("Failed to create cleanup cookie header value: {}", e);
                return response;
            }
        };
        response
            .headers_mut()
            .insert(axum::http::header::SET_COOKIE, cleanup_cookie);
        response
    }
}

impl FromRequestParts<AppState> for AuthenticatedUserPages {
    type Rejection = AuthRedirect;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let cookies = parts
            .extract::<TypedHeader<headers::Cookie>>()
            .await
            .map_err(|e| match e.name().as_str() {
                COOKIE_HEADER_NAME => match e.reason() {
                    TypedHeaderRejectionReason::Missing => AuthRedirect,
                    other => {
                        error!("Failed to extract cookie: {:?}", other);
                        AuthRedirect
                    }
                },
                other => {
                    error!("Failed to extract cookie: unexpected header: {:?}", other);
                    AuthRedirect
                }
            })?;

        let session_cookie = cookies.get(SESSION_COOKIE_NAME).ok_or(AuthRedirect)?;
        let opaque_session_token_value =
            OpaqueTokenValue::new(session_cookie.to_string()).map_err(|_| AuthRedirect)?;
        let session_token_hash = opaque_session_token_value.hash();

        let user = state
            .auth_service
            .get_user_by_session_token(&session_token_hash)
            .await
            .map_err(|_| AuthRedirect)?;

        Ok(AuthenticatedUserPages {
            user,
            session_token_hash,
        })
    }
}
