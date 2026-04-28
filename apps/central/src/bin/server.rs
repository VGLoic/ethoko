use dotenvy::dotenv;
use ethoko_central::httpserver::serve_http_server;
use tracing::{info, level_filters::LevelFilter};
use tracing_subscriber::{Layer, layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    if let Err(err) = dotenv()
        && !err.not_found()
    {
        return Err(anyhow::anyhow!("Error while loading .env file: {err}"));
    }

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .with_filter(Into::<LevelFilter>::into(LevelFilter::TRACE)),
        )
        .init();

    let addr = format!("0.0.0.0:{}", 3000);
    let listener = tokio::net::TcpListener::bind(&addr).await.map_err(|err| {
        anyhow::anyhow!("Error while binding the TCP listener to address {addr}: {err}")
    })?;

    info!(
        "Successfully bind the TCP listener to address {}\n",
        listener.local_addr().unwrap()
    );

    serve_http_server(listener).await
}
