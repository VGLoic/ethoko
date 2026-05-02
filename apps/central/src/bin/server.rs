use dotenvy::dotenv;
use ethoko_central::{config::Config, httpserver::serve_http_server};
use sqlx::postgres::PgPoolOptions;
use std::time::Duration;
use tracing::{info, level_filters::LevelFilter};
use tracing_subscriber::{Layer, layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    if let Err(err) = dotenv()
        && !err.not_found()
    {
        return Err(anyhow::Error::new(err).context("Error while loading .env file"));
    }

    let config = match Config::parse_from_env() {
        Ok(c) => c,
        Err(errors) => {
            return Err(anyhow::anyhow!(
                "Failed to parse environment variables for configuration with errors: {}",
                errors
                    .into_iter()
                    .map(|e| e.to_string())
                    .collect::<Vec<String>>()
                    .join(", ")
            ));
        }
    };

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .with_filter(Into::<LevelFilter>::into(config.log_level)),
        )
        .init();

    let pool = match PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&config.database_url)
        .await
    {
        Ok(c) => c,
        Err(e) => {
            return Err(anyhow::Error::new(e).context("Failed to establish connection to database"));
        }
    };

    if let Err(e) = sqlx::migrate!("./migrations").run(&pool).await {
        return Err(anyhow::Error::new(e).context("Failed to run database migrations"));
    };

    info!("Successfully ran migrations");

    let addr = format!("0.0.0.0:{}", config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await.map_err(|err| {
        anyhow::Error::new(err).context(format!(
            "Error while binding the TCP listener to address {addr}"
        ))
    })?;

    info!(
        "Successfully bind the TCP listener to address {}\n",
        listener.local_addr().unwrap()
    );

    serve_http_server(listener).await
}
