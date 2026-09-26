import { getSession } from "./sessions.server";
import { redirect } from "react-router";

/**
 * Retrieves the session token from the HTTP headers or redirects to the login page if not found.
 * @param headers The HTTP headers containing the cookie with the session token.
 */
export async function getSessionTokenOrRedirect(
  headers: Headers,
): Promise<{ token: string }> {
  const session = await getSession(headers.get("cookie"));
  const token = session.get("token");
  if (!token) {
    throw redirect("/login");
  }
  return { token };
}
