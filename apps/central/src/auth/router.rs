use crate::auth::handlers::logout::handle_logout;
use crate::router::IpRateLimiter;
use crate::{
    auth::handlers::{
        login_email::handle_login_email,
        login_email_form_action::handle_login_email_email_form_action,
        login_email_form_render::handle_render_login_email_form,
        logout_form_action::handle_logout_form_action, me::handle_me, me_render::handle_render_me,
        resend_verification_otp::handle_resend_verification_otp,
        resend_verification_otp_form_action::handle_resend_verification_otp_form_action,
        signup_email::handle_signup_email,
        signup_email_form_action::handle_signup_email_form_action,
        signup_email_form_render::handle_render_signup_email_form,
        verify_email::handle_verify_email, verify_email_action::handle_verify_email_action,
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

    let api_router = Router::new()
        .route("/signup/email", post(handle_signup_email))
        .route("/verify-email", post(handle_verify_email))
        .route(
            "/resend-verification-otp",
            post(handle_resend_verification_otp),
        )
        .route("/login", post(handle_login_email))
        .route("/logout", post(handle_logout))
        .route("/me", get(handle_me));

    let pages_router = Router::new()
        .route(
            "/signup/email",
            post(handle_signup_email_form_action).get(handle_render_signup_email_form),
        )
        .route("/verify-email", get(handle_verify_email_action))
        .route(
            "/resend-verification-otp",
            post(handle_resend_verification_otp_form_action),
        )
        .route(
            "/login",
            post(handle_login_email_email_form_action).get(handle_render_login_email_form),
        )
        .route("/logout", post(handle_logout_form_action))
        .route("/me", get(handle_render_me));

    let router = api_router
        .nest("/pages", pages_router)
        .layer(GovernorLayer::new(auth_router_governor_conf));

    Ok((router, IpRateLimiter::new(limiter)))
}
