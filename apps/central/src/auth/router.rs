use crate::auth::handlers::logout::handle_logout;
use crate::router::IpRateLimiter;
use crate::{
    auth::handlers::{
        login_email::handle_login_email, me::handle_me,
        resend_verification_otp::handle_resend_verification_otp, signup_email::handle_signup_email,
        verify_email::handle_verify_email,
    },
    config::RateLimitConfig,
    router::AppState,
};
use axum::{
    Router,
    routing::{get, post},
};
use tower_governor::GovernorLayer;
use tower_governor::governor::GovernorConfigBuilder;

pub fn router(
    rate_limit_config: RateLimitConfig,
) -> Result<(Router<AppState>, IpRateLimiter), anyhow::Error> {
    let auth_router_governor_conf = GovernorConfigBuilder::default()
        .per_second(rate_limit_config.replenishment_per_second)
        .burst_size(rate_limit_config.max_burst_size)
        .finish()
        .ok_or_else(|| {
            anyhow::anyhow!("Error while building the auth router governor configuration")
        })?;

    let limiter = auth_router_governor_conf.limiter().clone();

    let router = Router::new()
        .route("/signup/email", post(handle_signup_email))
        .route("/verify-email", post(handle_verify_email))
        .route(
            "/resend-verification-otp",
            post(handle_resend_verification_otp),
        )
        .route("/login/email", post(handle_login_email))
        .route("/logout", post(handle_logout))
        .route("/me", get(handle_me))
        .layer(GovernorLayer::new(auth_router_governor_conf));

    Ok((router, IpRateLimiter::new(limiter)))
}
