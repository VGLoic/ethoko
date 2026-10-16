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
    `/login?error=${encodeURIComponent(errorMessage ?? "We couldn’t complete GitHub sign-in. Try signing in again.")}`,
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
      "Your GitHub sign-in session is missing. Try signing in again.",
    );
  }

  if (state !== queryParsingResult.data.state) {
    throw await redirectToLogin(
      session,
      "Your GitHub sign-in session could not be verified. Try signing in again.",
    );
  }

  const exchangeCodeResult = await ethokoCentralClient
    .exchangeCodeForToken({
      code: queryParsingResult.data.code,
      state: queryParsingResult.data.state,
    })
    .catch(async (err) => {
      console.error("Error exchanging code for token:", err);
      throw await redirectToLogin(
        session,
        "The GitHub sign-in service is unavailable. Try again in a moment.",
      );
    });

  if (exchangeCodeResult.variant === "unprocessable-entity") {
    const errorMessage =
      exchangeCodeResult.reason === "primary-email-collision"
        ? "This email is already registered. Sign in with your email and password, then link GitHub."
        : exchangeCodeResult.reason === "oauth-transaction-not-found"
          ? "Your GitHub sign-in request was not found. Try signing in again."
          : exchangeCodeResult.reason === "oauth-transaction-expired"
            ? "Your GitHub sign-in request has expired. Try signing in again."
            : exchangeCodeResult.reason === "unknown"
              ? "We couldn’t complete GitHub sign-in. Try again in a moment."
              : "We couldn’t complete GitHub sign-in. Try again in a moment.";

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
