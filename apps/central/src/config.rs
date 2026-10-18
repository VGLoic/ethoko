use std::{
    env::{self, VarError},
    str::FromStr,
};

use anyhow::Error;
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
    /// Password recovery delivery and lifetime configuration.
    pub password_recovery_config: PasswordRecoveryConfig,
    /// Global rate limit configuration
    pub global_rate_limit_config: RateLimitConfig,
    /// Auth rate limit configuration for specific public routes, e.g. re-send verification OTP
    pub auth_rate_limit_config: RateLimitConfig,
    /// Resend API key for sending emails
    pub resend_api_key: String,
    /// Shared secret used by the Central UI BFF to authenticate to Central
    pub central_ui_bff_shared_secret: String,
    /// GitHub OAuth client configuration
    pub github_oauth_client_config: OauthClientConfig,
    /// Time to live for Oauth transaction in seconds
    pub oauth_transaction_ttl_seconds: u16,
    /// GitHub API base URL
    pub github_api_url: String,
}

#[derive(Clone, Debug)]
pub struct OauthClientConfig {
    pub client_id: oauth2::ClientId,
    pub client_secret: oauth2::ClientSecret,
    pub callback_url: oauth2::RedirectUrl,
    pub auth_url: oauth2::AuthUrl,
    pub auth_token_url: oauth2::TokenUrl,
}

#[derive(Clone, Debug)]
pub struct OtpConfig {
    /// Time to live in seconds for OTP
    pub ttl_seconds: u16,
    /// Cooldown between two OTP for a single user in seconds
    pub cooldown_seconds: u16,
}

#[derive(Clone, Debug)]
pub struct PasswordRecoveryConfig {
    pub cooldown_seconds: u16,
    pub ttl_seconds: u16,
    pub web_app_url: String,
}

#[derive(Clone, Debug)]
pub struct RateLimitConfig {
    /// Maximum number of requests per second
    pub replenishment_per_second: u64,
    /// Maximum burst size
    pub max_burst_size: u32,
}

const EMPTY_STRING: &str = "";
const DUMMY_URL: &str = "https://google.com";
const GITHUB_API_URL: &str = "https://api.github.com";

impl Config {
    pub fn parse_from_env() -> Result<Self, Vec<anyhow::Error>> {
        let mut errors = Vec::new();

        let self_url = match parse_required_env_variable::<String>("SELF_URL") {
            Ok(v) => v,
            Err(e) => {
                errors.push(e);
                DUMMY_URL.into()
            }
        };

        let web_app_url = match parse_required_env_variable::<String>("WEB_APP_URL") {
            Ok(v) => v,
            Err(e) => {
                errors.push(e);
                DUMMY_URL.into()
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
                EMPTY_STRING.into()
            }
        };

        let central_ui_bff_shared_secret =
            match parse_required_env_variable::<String>("CENTRAL_UI_BFF_SHARED_SECRET") {
                Ok(v) => v,
                Err(e) => {
                    errors.push(e);
                    EMPTY_STRING.into()
                }
            };

        let (github_oauth_client_config, github_oauth_errors) = parse_github_oauth_client_config();

        let oauth_transaction_ttl_seconds =
            match parse_env_variable::<u16>("OAUTH_TRANSACTION_TTL_SECONDS") {
                Ok(Some(v)) => v,
                Ok(None) => 600, // default to 10 minutes
                Err(e) => {
                    errors.push(e);
                    600 // default to 10 minutes
                }
            };

        let github_api_url = match parse_env_variable::<String>("GITHUB_API_URL") {
            Ok(v) => v.unwrap_or(GITHUB_API_URL.into()),
            Err(e) => {
                errors.push(e);
                GITHUB_API_URL.into()
            }
        };

        let recovery_cooldown = match parse_env_variable::<u16>("PASSWORD_RESET_COOLDOWN_SECONDS") {
            Ok(value) => value.unwrap_or(60),
            Err(error) => {
                errors.push(error);
                60
            }
        };
        errors.extend(github_oauth_errors);
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
            password_recovery_config: PasswordRecoveryConfig {
                cooldown_seconds: recovery_cooldown,
                ttl_seconds: 3600,
                web_app_url: web_app_url.clone(),
            },
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
            github_oauth_client_config,
            oauth_transaction_ttl_seconds,
            github_api_url,
        })
    }
}

fn parse_github_oauth_client_config() -> (OauthClientConfig, Vec<Error>) {
    let mut errors = Vec::new();

    let client_id = match parse_required_env_variable::<String>("GITHUB_OAUTH_CLIENT_ID") {
        Ok(v) => v,
        Err(e) => {
            errors.push(e);
            EMPTY_STRING.into()
        }
    };
    let client_id = oauth2::ClientId::new(client_id);

    let client_secret = match parse_required_env_variable::<String>("GITHUB_OAUTH_CLIENT_SECRET") {
        Ok(v) => v,
        Err(e) => {
            errors.push(e);
            EMPTY_STRING.into()
        }
    };
    let client_secret = oauth2::ClientSecret::new(client_secret);

    let callback_url = match parse_required_env_variable::<String>("GITHUB_OAUTH_CALLBACK_URL") {
        Ok(v) => v,
        Err(e) => {
            errors.push(e);
            DUMMY_URL.into()
        }
    };
    let callback_url = match oauth2::RedirectUrl::new(callback_url) {
        Ok(v) => v,
        Err(e) => {
            errors.push(anyhow::Error::new(e));
            oauth2::RedirectUrl::new(DUMMY_URL.into()).unwrap()
        }
    };

    let auth_url = match parse_required_env_variable::<String>("GITHUB_OAUTH_AUTH_URL") {
        Ok(v) => v,
        Err(e) => {
            errors.push(e);
            EMPTY_STRING.into()
        }
    };
    let auth_url = match oauth2::AuthUrl::new(auth_url) {
        Ok(v) => v,
        Err(e) => {
            errors.push(anyhow::Error::new(e));
            oauth2::AuthUrl::new(DUMMY_URL.into()).unwrap()
        }
    };

    let auth_token_url = match parse_required_env_variable::<String>("GITHUB_OAUTH_AUTH_TOKEN_URL")
    {
        Ok(v) => v,
        Err(e) => {
            errors.push(e);
            EMPTY_STRING.into()
        }
    };
    let auth_token_url = match oauth2::TokenUrl::new(auth_token_url) {
        Ok(v) => v,
        Err(e) => {
            errors.push(anyhow::Error::new(e));
            oauth2::TokenUrl::new(DUMMY_URL.into()).unwrap()
        }
    };

    let oauth_client_config = OauthClientConfig {
        client_id,
        client_secret,
        callback_url,
        auth_url,
        auth_token_url,
    };

    (oauth_client_config, errors)
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
