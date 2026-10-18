import { isIP } from "node:net";

// This reserved header is ALWAYS overwritten at the Node socket boundary, before
// React Router receives the request. Never forward a browser-supplied value.
export function stampSourceIp(request) {
  const peer = request.socket.remoteAddress;
  let ip = peer?.replace(/^::ffff:/, "");
  const trusted = (process.env.TRUSTED_PROXY_IPS ?? "")
    .split(",")
    .map((value) => value.trim());
  if (trusted.includes(ip)) {
    // A trusted ingress must overwrite this header with one source IP, not append a chain.
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded !== "string" || !isIP(forwarded)) {
      delete request.headers["x-ethoko-source-ip"];
      return;
    }
    ip = forwarded;
  }
  if (ip && isIP(ip)) request.headers["x-ethoko-source-ip"] = ip;
  else delete request.headers["x-ethoko-source-ip"];
}
