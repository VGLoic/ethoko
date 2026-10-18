import { Form, Link, data, useNavigation } from "react-router";
import type { Route } from "./+types/reset-password";
import { ethokoCentralClient } from "~/server/ethoko-central-api/index.server";
import { centralSession } from "~/server/sessions.server";
import { recoveryClientIp, recoveryFailure } from "~/server/recovery.server";

export function meta() {
  return [{ title: "Reset password" }];
}
export function headers() {
  return { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!token) return { token, valid: false, error: null };
  try {
    const result = await ethokoCentralClient.validatePasswordReset(
      token,
      recoveryClientIp(request),
    );
    return { token, valid: result.variant === "success", error: null };
  } catch (error) {
    const failure = recoveryFailure(error);
    return data(
      { token, valid: false, error: failure.error },
      { status: failure.status },
    );
  }
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const password = String(form.get("password") ?? "");
  if (password !== form.get("confirmation"))
    return data(
      { success: false, invalid: false, error: "Passwords do not match." },
      { status: 422 },
    );
  try {
    // Central's shared signup validator is authoritative, including trimming and UTF-8 bytes.
    const result = await ethokoCentralClient.resetPassword(
      token,
      password,
      recoveryClientIp(request),
    );
    if (result.variant !== "success")
      return data(
        {
          success: false,
          invalid: result.reason === "invalid-link",
          error:
            result.reason === "invalid-password"
              ? "Use at least 8 UTF-8 bytes, including uppercase, lowercase, a digit and a special character."
              : result.reason === "invalid-link"
                ? null
                : "Password recovery is temporarily unavailable. Please try again.",
        },
        { status: 422 },
      );
    const session = await centralSession.getSession(
      request.headers.get("Cookie"),
    );
    return data(
      { success: true, invalid: false, error: null },
      {
        headers: { "Set-Cookie": await centralSession.destroySession(session) },
      },
    );
  } catch (error) {
    const failure = recoveryFailure(error);
    return data(
      { success: false, invalid: false, error: failure.error },
      { status: failure.status },
    );
  }
}

export default function ResetPassword({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  if (actionData?.success)
    return (
      <main className="flex flex-col pt-16 pb-4 px-8 gap-8">
        <h1>Your password has been reset.</h1>
        <Link to="/login">Log in</Link>
      </main>
    );
  if (loaderData.error)
    return (
      <main>
        <p role="alert">{loaderData.error}</p>
        <Link reloadDocument to="">
          Try again
        </Link>
      </main>
    );
  if (!loaderData.valid || actionData?.invalid)
    return (
      <main className="flex flex-col pt-16 pb-4 px-8 gap-8">
        <h1>This reset link is invalid or expired.</h1>
        <Link to="/forgot-password">Request another link</Link>
      </main>
    );
  return (
    <main className="flex flex-col pt-16 pb-4 px-8 gap-8">
      <h1>Choose a new password</h1>
      <p>
        Use at least 8 UTF-8 bytes, including uppercase, lowercase, a digit and
        a special character.
      </p>
      {actionData?.error && <p role="alert">{actionData.error}</p>}
      <Form method="post" className="flex flex-col gap-4">
        <label>
          New password
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            required
            className="border p-2"
          />
        </label>
        <label>
          Confirm new password
          <input
            type="password"
            name="confirmation"
            autoComplete="new-password"
            required
            className="border p-2"
          />
        </label>
        <button type="submit" disabled={busy}>
          Reset password
        </button>
      </Form>
    </main>
  );
}
