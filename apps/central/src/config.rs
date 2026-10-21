use std::{
    env::{self, VarError},
    path::PathBuf,
    str::FromStr,
};

use anyhow::Error;
use tracing::Level;

/// Public application configuration
pub struct Config {
    /// Runtime environment; defaults to production independently of build profile.
    pub environment: Environment,
    /// Explicit email delivery selection; defaults to Resend.
    pub email_transport: EmailTransport,
    /// Directory for local email capture, required only for local capture.
    pub email_capture_dir: Option<PathBuf>,
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
    /// Cooldown between password recovery emails, in seconds.
    pub password_reset_cooldown_seconds: u16,
    /// Global rate limit configuration
    pub global_rate_limit_config: RateLimitConfig,
    /// Auth rate limit configuration for specific public routes, e.g. re-send verification OTP
    pub auth_rate_limit_config: RateLimitConfig,
    /// Resend API key for sending emails, required only for Resend
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

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Environment {
    Development,
    #[default]
    Production,
}

impl FromStr for Environment {
    type Err = std::io::Error;

    /// Parse a runtime environment; reject values other than development or production.
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "development" => Ok(Self::Development),
            "production" => Ok(Self::Production),
            _ => Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "expected development or production",
            )),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum EmailTransport {
    #[default]
    Resend,
    LocalCapture,
}

impl FromStr for EmailTransport {
    type Err = std::io::Error;

    /// Parse an email transport; reject values other than resend or local-capture.
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "resend" => Ok(Self::Resend),
            "local-capture" => Ok(Self::LocalCapture),
            _ => Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "expected resend or local-capture",
            )),
        }
    }
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
        Self::parse_from_lookup(&|key| env::var(key))
    }

    fn parse_from_lookup(
        lookup: &impl Fn(&str) -> Result<String, VarError>,
    ) -> Result<Self, Vec<anyhow::Error>> {
        let mut errors = Vec::new();

        let environment = match parse_env_variable::<Environment>(lookup, "CENTRAL_ENVIRONMENT") {
            Ok(v) => v.unwrap_or_default(),
            Err(e) => {
                errors.push(e);
                Environment::default()
            }
        };
        let email_transport =
            match parse_env_variable::<EmailTransport>(lookup, "CENTRAL_EMAIL_TRANSPORT") {
                Ok(v) => v.unwrap_or_default(),
                Err(e) => {
                    errors.push(e);
                    EmailTransport::default()
                }
            };

        let self_url = match parse_required_env_variable::<String>(lookup, "SELF_URL") {
            Ok(v) => v,
            Err(e) => {
                errors.push(e);
                DUMMY_URL.into()
            }
        };

        let web_app_url = match parse_required_env_variable::<String>(lookup, "WEB_APP_URL") {
            Ok(v) => v,
            Err(e) => {
                errors.push(e);
                DUMMY_URL.into()
            }
        };

        let port = match parse_env_variable::<u16>(lookup, "PORT") {
            Ok(v) => v.unwrap_or(3000),
            Err(e) => {
                errors.push(e);
                0
            }
        };

        let database_url = match parse_required_env_variable::<String>(lookup, "DATABASE_URL") {
            Ok(v) => v,
            Err(e) => {
                errors.push(e);
                "postgresql://user:password@host:port/database".into()
            }
        };

        let log_level = match parse_env_variable::<Level>(lookup, "LOG_LEVEL") {
            Ok(v) => v.unwrap_or(Level::INFO),
            Err(e) => {
                errors.push(e);
                Level::INFO
            }
        };

        let resend_api_key = match parse_env_variable::<String>(lookup, "RESEND_API_KEY") {
            Ok(v) => v.unwrap_or_default(),
            Err(e) => {
                errors.push(e);
                EMPTY_STRING.into()
            }
        };

        let email_capture_dir =
            match parse_env_variable::<PathBuf>(lookup, "CENTRAL_EMAIL_CAPTURE_DIR") {
                Ok(v) => v,
                Err(e) => {
                    errors.push(e);
                    None
                }
            };

        let central_ui_bff_shared_secret =
            match parse_required_env_variable::<String>(lookup, "CENTRAL_UI_BFF_SHARED_SECRET") {
                Ok(v) => v,
                Err(e) => {
                    errors.push(e);
                    EMPTY_STRING.into()
                }
            };

        let (github_oauth_client_config, github_oauth_errors) =
            parse_github_oauth_client_config(lookup);

        let oauth_transaction_ttl_seconds =
            match parse_env_variable::<u16>(lookup, "OAUTH_TRANSACTION_TTL_SECONDS") {
                Ok(Some(v)) => v,
                Ok(None) => 600, // default to 10 minutes
                Err(e) => {
                    errors.push(e);
                    600 // default to 10 minutes
                }
            };

        let github_api_url = match parse_env_variable::<String>(lookup, "GITHUB_API_URL") {
            Ok(v) => v.unwrap_or(GITHUB_API_URL.into()),
            Err(e) => {
                errors.push(e);
                GITHUB_API_URL.into()
            }
        };

        let password_reset_cooldown_seconds =
            match parse_env_variable::<u16>(lookup, "PASSWORD_RESET_COOLDOWN_SECONDS") {
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

        let config = Config {
            environment,
            email_transport,
            email_capture_dir,
            self_url,
            web_app_url,
            port,
            database_url,
            log_level,
            otp_config,
            password_reset_cooldown_seconds,
            global_rate_limit_config,
            auth_rate_limit_config,
            resend_api_key,
            central_ui_bff_shared_secret,
            github_oauth_client_config,
            oauth_transaction_ttl_seconds,
            github_api_url,
        };
        config.validate()?;
        Ok(config)
    }

    /// Check cross-field runtime constraints before opening application resources.
    /// Returns all inconsistent configuration choices.
    pub fn validate(&self) -> Result<(), Vec<anyhow::Error>> {
        let mut errors = Vec::new();
        match self.email_transport {
            EmailTransport::Resend => {
                if self.resend_api_key.is_empty() {
                    errors.push(anyhow::anyhow!(
                        "Required environment variable RESEND_API_KEY is not set or is empty"
                    ));
                }
            }
            EmailTransport::LocalCapture => {
                if self.environment != Environment::Development {
                    errors.push(anyhow::anyhow!(
                        "local-capture requires CENTRAL_ENVIRONMENT=development"
                    ));
                }
                if self
                    .email_capture_dir
                    .as_ref()
                    .is_none_or(|path| path.as_os_str().is_empty())
                {
                    errors.push(anyhow::anyhow!(
                        "local-capture requires CENTRAL_EMAIL_CAPTURE_DIR"
                    ));
                }
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

fn parse_github_oauth_client_config(
    lookup: &impl Fn(&str) -> Result<String, VarError>,
) -> (OauthClientConfig, Vec<Error>) {
    let mut errors = Vec::new();

    let client_id = match parse_required_env_variable::<String>(lookup, "GITHUB_OAUTH_CLIENT_ID") {
        Ok(v) => v,
        Err(e) => {
            errors.push(e);
            EMPTY_STRING.into()
        }
    };
    let client_id = oauth2::ClientId::new(client_id);

    let client_secret =
        match parse_required_env_variable::<String>(lookup, "GITHUB_OAUTH_CLIENT_SECRET") {
            Ok(v) => v,
            Err(e) => {
                errors.push(e);
                EMPTY_STRING.into()
            }
        };
    let client_secret = oauth2::ClientSecret::new(client_secret);

    let callback_url =
        match parse_required_env_variable::<String>(lookup, "GITHUB_OAUTH_CALLBACK_URL") {
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

    let auth_url = match parse_required_env_variable::<String>(lookup, "GITHUB_OAUTH_AUTH_URL") {
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

    let auth_token_url =
        match parse_required_env_variable::<String>(lookup, "GITHUB_OAUTH_AUTH_TOKEN_URL") {
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

fn parse_required_env_variable<T>(
    lookup: &impl Fn(&str) -> Result<String, VarError>,
    key: &str,
) -> Result<T, anyhow::Error>
where
    T: FromStr,
    <T as FromStr>::Err: std::error::Error + Send + Sync + 'static,
{
    parse_env_variable(lookup, key)?.ok_or_else(|| {
        anyhow::anyhow!("Required environment variable {key} is not set or is empty")
    })
}

fn parse_env_variable<T>(
    lookup: &impl Fn(&str) -> Result<String, VarError>,
    key: &str,
) -> Result<Option<T>, anyhow::Error>
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

    let env_value = match lookup(key) {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn config(overrides: &[(&str, Option<&str>)]) -> Result<Config, Vec<Error>> {
        let mut variables = std::collections::HashMap::from([
            ("SELF_URL", "https://central.example.com"),
            ("WEB_APP_URL", "https://app.example.com"),
            ("DATABASE_URL", "postgresql://localhost/central"),
            ("RESEND_API_KEY", "test-key"),
            ("CENTRAL_UI_BFF_SHARED_SECRET", "test-secret"),
            ("GITHUB_OAUTH_CLIENT_ID", "test-client"),
            ("GITHUB_OAUTH_CLIENT_SECRET", "test-secret"),
            (
                "GITHUB_OAUTH_CALLBACK_URL",
                "https://central.example.com/callback",
            ),
            (
                "GITHUB_OAUTH_AUTH_URL",
                "https://github.com/login/oauth/authorize",
            ),
            (
                "GITHUB_OAUTH_AUTH_TOKEN_URL",
                "https://github.com/login/oauth/access_token",
            ),
        ]);
        for (key, value) in overrides {
            if let Some(value) = value {
                variables.insert(key, value);
            } else {
                variables.remove(key);
            }
        }
        Config::parse_from_lookup(&|key| {
            variables
                .get(key)
                .map(|value| value.to_string())
                .ok_or(VarError::NotPresent)
        })
    }

    #[test]
    fn omitted_environment_and_transport_preserve_production_resend_defaults() {
        let config = config(&[]).unwrap();
        assert_eq!(config.environment, Environment::Production);
        assert_eq!(config.email_transport, EmailTransport::Resend);
        assert_eq!(config.resend_api_key, "test-key");
    }

    #[test]
    fn production_rejects_local_capture_even_when_environment_is_omitted() {
        for environment in [None, Some("production")] {
            let errors = config(&[
                ("CENTRAL_ENVIRONMENT", environment),
                ("CENTRAL_EMAIL_TRANSPORT", Some("local-capture")),
                ("CENTRAL_EMAIL_CAPTURE_DIR", Some("./captured-emails")),
            ])
            .err()
            .expect("production must reject local capture");
            assert!(errors.iter().any(|error| {
                error
                    .to_string()
                    .contains("local-capture requires CENTRAL_ENVIRONMENT=development")
            }));
        }
    }

    #[test]
    fn development_local_capture_requires_directory() {
        for directory in [None, Some("")] {
            let errors = config(&[
                ("CENTRAL_ENVIRONMENT", Some("development")),
                ("CENTRAL_EMAIL_TRANSPORT", Some("local-capture")),
                ("CENTRAL_EMAIL_CAPTURE_DIR", directory),
                ("RESEND_API_KEY", None),
            ])
            .err()
            .expect("capture directory is required");
            let messages: Vec<_> = errors.iter().map(ToString::to_string).collect();
            assert_eq!(
                messages
                    .iter()
                    .any(|message| message.contains("CENTRAL_EMAIL_CAPTURE_DIR")),
                directory.is_none_or(str::is_empty)
            );
            assert!(
                !messages
                    .iter()
                    .any(|message| message.contains("RESEND_API_KEY")),
                "{messages:?}"
            );
        }
    }

    #[test]
    fn development_local_capture_needs_no_resend_key() {
        let config = config(&[
            ("CENTRAL_ENVIRONMENT", Some("development")),
            ("CENTRAL_EMAIL_TRANSPORT", Some("local-capture")),
            ("CENTRAL_EMAIL_CAPTURE_DIR", Some("./captured-emails")),
            ("RESEND_API_KEY", None),
        ])
        .unwrap();
        assert_eq!(config.email_transport, EmailTransport::LocalCapture);
        assert!(config.resend_api_key.is_empty());
    }

    #[test]
    fn resend_requires_provider_configuration_in_every_environment() {
        for environment in [None, Some("production"), Some("development")] {
            for transport in [None, Some("resend")] {
                let settings = [
                    ("CENTRAL_ENVIRONMENT", environment),
                    ("CENTRAL_EMAIL_TRANSPORT", transport),
                ];
                let valid = config(&settings).unwrap();
                assert_eq!(valid.email_transport, EmailTransport::Resend);
                assert_eq!(
                    valid.environment,
                    if environment == Some("development") {
                        Environment::Development
                    } else {
                        Environment::Production
                    }
                );
                for key in [None, Some("")] {
                    let errors = config(&[settings[0], settings[1], ("RESEND_API_KEY", key)])
                        .err()
                        .expect("Resend needs a key");
                    assert!(
                        errors
                            .iter()
                            .any(|error| error.to_string().contains("RESEND_API_KEY"))
                    );
                }
            }
        }
    }

    #[test]
    fn unknown_environment_and_transport_fail_validation() {
        for (name, value) in [
            ("CENTRAL_ENVIRONMENT", "staging"),
            ("CENTRAL_ENVIRONMENT", "Development"),
            ("CENTRAL_EMAIL_TRANSPORT", "smtp"),
        ] {
            let errors = config(&[(name, Some(value))])
                .err()
                .expect("unknown setting must fail");
            assert!(errors.iter().any(|error| error.to_string().contains(name)));
        }
    }

    #[test]
    fn validation_checks_config_values_independently_of_environment_parsing() {
        let mut config = config(&[]).unwrap();
        config.resend_api_key.clear();
        assert!(config.validate().is_err());
        config.email_transport = EmailTransport::LocalCapture;
        config.email_capture_dir = Some(PathBuf::from("./captured-emails"));
        let errors = config.validate().unwrap_err();
        assert!(errors.iter().any(|error| {
            error
                .to_string()
                .contains("requires CENTRAL_ENVIRONMENT=development")
        }));
        config.environment = Environment::Development;
        assert!(config.validate().is_ok());
    }
}
