// Public Central API fixture for browser tests. Backend invariants are covered
// separately through Central's real PostgreSQL HTTP integration tests.
import { createServer } from "node:http";
const consumed = new Set();
createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/health") return response.end("{}");
  if (
    request.headers.authorization !== "Bearer browser-test-machine-credential"
  ) {
    response.writeHead(401).end("{}");
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
  if (!request.headers["x-ethoko-client-ip"]?.includes("127.0.0.1")) {
    response.writeHead(400).end("{}");
    return;
  }
  if (request.url === "/auth/forgot-password") {
    response.end(
      JSON.stringify({
        message:
          "If this account is eligible for password recovery, you’ll receive an email.",
        cooldownSeconds: 2,
      }),
    );
  } else if (body.token?.startsWith("valid-") && !consumed.has(body.token)) {
    if (request.url === "/auth/reset-password") {
      if (body.password !== "  Aa1ééé  ") {
        response
          .writeHead(422)
          .end(JSON.stringify({ code: "ETKAG01", reason: "Invalid password" }));
        return;
      }
      consumed.add(body.token);
    }
    response.end("{}");
  } else {
    response
      .writeHead(422)
      .end(
        JSON.stringify({
          code: "ETKARP01",
          reason: "Invalid or expired reset link",
        }),
      );
  }
}).listen(5189, "127.0.0.1");
