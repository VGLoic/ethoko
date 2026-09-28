use std::{
    env::{self, VarError},
    str::FromStr,
};

use tracing::Level;

/// Public application configuration
pub struct Config {
    /// Self URL of the server, e.g. `https://example.com`
    pub self_url: String,
    /// URL of the web application, e.g. `https://app.example.com`
    pub web_app_url: String,
    /// Server port
    pub port: u16,
    /// Database URL, in the format `postgresql://user:password@host:port/database`
    pub database_url: String,
    /// Application log level, has priority over `RUST_LOG` environment variable
    pub log_level: Level,
    /// OTP configuration
    pub otp_config: OtpConfig,
    /// Global rate limit configuration
    pub global_rate_limit_config: RateLimitConfig,
    /// Auth rate limit configuration for specific public routes, e.g. re-send verification OTP
    pub auth_rate_limit_config: RateLimitConfig,
    /// Resend API key for sending emails
    pub resend_api_key: String,
    /// Shared secret used by the Central UI BFF to authenticate to Central
    pub central_ui_bff_shared_secret: String,
}

#[derive(Clone, Debug)]
pub struct OtpConfig {
    /// Time to live in seconds for OTP
    pub ttl_seconds: u16,
    /// Cooldown between two OTP for a single user in seconds
    pub cooldown_seconds: u16,
}

#[derive(Clone, Debug)]
pub struct RateLimitConfig {
    /// Maximum number of requests per second
    pub replenishment_per_second: u64,
    /// Maximum burst size
    pub max_burst_size: u32,
}

impl Config {
    pub fn parse_from_env() -> Result<Self, Vec<anyhow::Error>> {
        let mut errors = Vec::new();

        let self_url = match parse_required_env_variable::<String>("SELF_URL") {
            Ok(v) => v,
            Err(e) => {
                errors.push(e);
                "http://localhost:3000".into()
            }
        };

        let web_app_url = match parse_required_env_variable::<String>("WEB_APP_URL") {
            Ok(v) => v,
            Err(e) => {
                errors.push(e);
                "http://localhost:3001".into()
            }
        };

        let port = match parse_env_variable::<u16>("PORT") {
            Ok(v) => v.unwrap_or(3000),
            Err(e) => {
                errors.push(e);
                0
            }
        };

        let database_url = match parse_required_env_variable::<String>("DATABASE_URL") {
            Ok(v) => v,
            Err(e) => {
                errors.push(e);
                "postgresql://user:password@host:port/database".into()
            }
        };

        let log_level = match parse_env_variable::<Level>("LOG_LEVEL") {
            Ok(v) => v.unwrap_or(Level::INFO),
            Err(e) => {
                errors.push(e);
                Level::INFO
            }
        };

        let resend_api_key = match parse_required_env_variable::<String>("RESEND_API_KEY") {
            Ok(v) => v,
            Err(e) => {
                errors.push(e);
                "".into()
            }
        };

        let central_ui_bff_shared_secret =
            match parse_required_env_variable::<String>("CENTRAL_UI_BFF_SHARED_SECRET") {
                Ok(v) => v,
                Err(e) => {
                    errors.push(e);
                    "".into()
                }
            };

        if !errors.is_empty() {
            return Err(errors);
        }

        let otp_config = OtpConfig {
            ttl_seconds: 10 * 60,
            cooldown_seconds: 60,
        };

        let global_rate_limit_config = RateLimitConfig {
            replenishment_per_second: 2,
            max_burst_size: 5,
        };

        let auth_rate_limit_config = RateLimitConfig {
            replenishment_per_second: 1,
            max_burst_size: 2,
        };

        Ok(Config {
            self_url,
            web_app_url,
            port,
            database_url,
            log_level,
            otp_config,
            global_rate_limit_config,
            auth_rate_limit_config,
            resend_api_key,
            central_ui_bff_shared_secret,
        })
    }
}

fn parse_required_env_variable<T>(key: &str) -> Result<T, anyhow::Error>
where
    T: FromStr,
    <T as FromStr>::Err: std::error::Error + Send + Sync + 'static,
{
    parse_env_variable(key)?.ok_or_else(|| {
        anyhow::anyhow!("Required environment variable {key} is not set or is empty")
    })
}

fn parse_env_variable<T>(key: &str) -> Result<Option<T>, anyhow::Error>
where
    T: FromStr,
    <T as FromStr>::Err: std::error::Error + Send + Sync + 'static,
{
    fn map_err<E>(key: &str, e: E) -> anyhow::Error
    where
        E: std::error::Error + Send + Sync + 'static,
    {
        anyhow::anyhow!("[{key}]: {e}")
    }

    let env_value = match env::var(key) {
        Ok(v) => {
            if v.is_empty() {
                Ok(None)
            } else {
                Ok(Some(v))
            }
        }
        Err(e) => {
            if e == VarError::NotPresent {
                Ok(None)
            } else {
                Err(map_err(key, e))
            }
        }
    }?;
    env_value
        .map(|v| v.parse::<T>().map_err(|e| map_err(key, e)))
        .transpose()
}
