import { redirect, type Session } from "react-router";
import type { Route } from "./+types/github-auth-callback";
import { githubOAuthSession, centralSession } from "~/server/sessions.server";
import z from "zod";
import { ethokoCentralClient } from "~/server/ethoko-central-api/index.server";

async function redirectToLogin(session?: Session, errorMessage?: string) {
  const headers: Record<string, string> = {};
  if (session) {
    headers["Set-Cookie"] = await githubOAuthSession.destroySession(session);
  }
  throw redirect(
    `/login?error=${encodeURIComponent(errorMessage ?? "Unknown error")}`,
    {
      headers,
    },
  );
}

export async function loader({ request }: Route.LoaderArgs) {
  const queryParams = new URL(request.url).searchParams;
  const queryParsingResult = z
    .object({
      code: z.string(),
      state: z.string(),
    })
    .safeParse({
      code: queryParams.get("code"),
      state: queryParams.get("state"),
    });
  if (!queryParsingResult.success) {
    throw await redirectToLogin();
  }
  const session = await githubOAuthSession.getSession(
    request.headers.get("Cookie"),
  );
  const state = session.get("state");
  if (!state) {
    throw await redirectToLogin(
      session,
      "Missing GitHub OAuth state in session",
    );
  }

  if (state !== queryParsingResult.data.state) {
    throw await redirectToLogin(session, "Invalid GitHub OAuth state");
  }

  const exchangeCodeResult = await ethokoCentralClient
    .exchangeCodeForToken({
      code: queryParsingResult.data.code,
      state: queryParsingResult.data.state,
    })
    .catch(async (err) => {
      console.error("Error exchanging code for token:", err);
      throw await redirectToLogin(session, "Fail to login with Github");
    });

  if (exchangeCodeResult.variant === "unprocessable-entity") {
    const errorMessage =
      exchangeCodeResult.reason === "primary-email-collision"
        ? "Account with this email already exist, need to login with email and then add Github auth"
        : exchangeCodeResult.reason === "oauth-transaction-not-found"
          ? "GitHub OAuth transaction not found"
          : exchangeCodeResult.reason === "oauth-transaction-expired"
            ? "GitHub OAuth transaction has expired"
            : exchangeCodeResult.reason === "unknown"
              ? "Unknown error occurred during GitHub OAuth token exchange"
              : "An unknown error occurred";

    throw await redirectToLogin(session, errorMessage);
  }

  // Destroy the GitHub OAuth session after successful login
  // Setup the obtained access token in the session
  const centralAuthSession = await centralSession.getSession(
    request.headers.get("Cookie"),
  );
  centralAuthSession.set("token", exchangeCodeResult.data.token);
  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    await githubOAuthSession.destroySession(session),
  );
  headers.append(
    "Set-Cookie",
    await centralSession.commitSession(centralAuthSession),
  );

  return redirect("/", {
    headers,
  });
}
