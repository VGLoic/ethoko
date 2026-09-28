use tracing::{Level, level_filters::LevelFilter};
use tracing_subscriber::{Layer, layer::SubscriberExt, util::SubscriberInitExt};

const CENTRAL_TEST_LOG: &str = "CENTRAL_TEST_LOG";
const VALID_LEVELS: &str = "error, warn, info, debug, or trace";

pub fn init() -> Result<(), String> {
    let Some(level) = log_level_from_env()? else {
        return Ok(());
    };

    let _ = tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().with_filter(LevelFilter::from_level(level)))
        .try_init();

    Ok(())
}

fn log_level_from_env() -> Result<Option<Level>, String> {
    std::env::var(CENTRAL_TEST_LOG)
        .ok()
        .map(|value| parse_log_level(&value))
        .transpose()
}

fn parse_log_level(value: &str) -> Result<Level, String> {
    match value {
        "error" => Ok(Level::ERROR),
        "warn" => Ok(Level::WARN),
        "info" => Ok(Level::INFO),
        "debug" => Ok(Level::DEBUG),
        "trace" => Ok(Level::TRACE),
        _ => Err(format!(
            "Invalid {CENTRAL_TEST_LOG} value {value:?}; expected one of: {VALID_LEVELS}."
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_standard_tracing_levels() {
        assert_eq!(parse_log_level("error"), Ok(Level::ERROR));
        assert_eq!(parse_log_level("warn"), Ok(Level::WARN));
        assert_eq!(parse_log_level("info"), Ok(Level::INFO));
        assert_eq!(parse_log_level("debug"), Ok(Level::DEBUG));
        assert_eq!(parse_log_level("trace"), Ok(Level::TRACE));
    }

    #[test]
    fn rejects_invalid_tracing_levels_with_configuration_guidance() {
        let error = parse_log_level("verbose").unwrap_err();

        assert_eq!(
            error,
            "Invalid CENTRAL_TEST_LOG value \"verbose\"; expected one of: error, warn, info, debug, or trace."
        );
    }
}
