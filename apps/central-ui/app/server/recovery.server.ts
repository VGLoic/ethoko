export function recoveryClientIp(request: Request): string {
  const ip = request.headers.get("x-ethoko-source-ip");
  if (!ip)
    throw new Response("Browser source address unavailable", { status: 503 });
  return ip;
}

export function recoveryFailure(error: unknown) {
  return {
    error:
      error instanceof Response && error.status === 429
        ? "Too many requests. Please try again later."
        : "Password recovery is temporarily unavailable. Please try again.",
    status: error instanceof Response ? error.status : 503,
  };
}
