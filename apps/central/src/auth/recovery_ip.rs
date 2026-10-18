use std::{net::IpAddr, sync::Arc};
use tower_governor::{
    errors::GovernorError,
    key_extractor::{KeyExtractor, PeerIpKeyExtractor},
};

/// Only the authenticated BFF can assert a browser's source address. All generic
/// forwarding headers are ignored, and other routes retain their existing peer limits.
#[derive(Clone)]
pub struct RecoveryIpKeyExtractor(pub Arc<String>);

impl KeyExtractor for RecoveryIpKeyExtractor {
    type Key = IpAddr;

    /// Identifies this extractor for tracing; cannot fail.
    fn name(&self) -> &'static str {
        "trusted recovery browser IP"
    }

    /// Uses the authenticated BFF's asserted browser IP for recovery, otherwise the peer IP.
    /// Returns UnableToExtractKey if the required source address is missing or invalid.
    fn extract<T>(&self, request: &axum::http::Request<T>) -> Result<IpAddr, GovernorError> {
        let path = request.uri().path();
        if (path.ends_with("/forgot-password")
            || path.ends_with("/reset-password")
            || path.ends_with("/reset-password/validate"))
            && request
                .headers()
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                == Some(self.0.as_str())
        {
            let ip: IpAddr = request
                .headers()
                .get("x-ethoko-client-ip")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse().ok())
                .ok_or(GovernorError::UnableToExtractKey)?;
            // IPv4-mapped IPv6 and IPv4 addresses must share a limit.
            return Ok(match ip {
                IpAddr::V6(ip) => ip
                    .to_ipv4_mapped()
                    .map(IpAddr::V4)
                    .unwrap_or(IpAddr::V6(ip)),
                _ => ip,
            });
        }
        PeerIpKeyExtractor.extract(request)
    }
}
