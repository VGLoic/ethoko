pub fn error_chain(error: &anyhow::Error) -> String {
    error
        .chain()
        .map(std::string::ToString::to_string)
        .collect::<Vec<_>>()
        .join(": ")
}

pub fn error_classification(error: &anyhow::Error) -> &'static str {
    if error.is::<tokio::time::error::Elapsed>() {
        "timeout"
    } else if error.is::<serde_json::Error>() {
        "invalid_payload"
    } else {
        "unexpected"
    }
}
