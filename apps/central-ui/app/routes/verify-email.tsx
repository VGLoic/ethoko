import z from "zod";
import type { Route } from "./+types/verify-email";
import { OtpSchema } from "~/server/newtypes.server";
import { getSession } from "~/server/sessions.server";
import { getSessionTokenOrRedirect } from "~/server/auth.server";
import { ethokoCentralClient } from "~/server/ethoko-central-api/index.server";
import { Form } from "react-router";

export async function loader({ request }: Route.LoaderArgs) {
  const { searchParams } = new URL(request.url);
  const otp = searchParams.get("otp");
  const email = searchParams.get("email");

  const emailParsingResult = z.email().safeParse(email);
  if (!emailParsingResult.success) {
    throw new Response("Not found", { status: 404 });
  }
  const otpParsingResult = OtpSchema.safeParse(otp);

  return {
    email: emailParsingResult.data,
    otp: otpParsingResult.success ? otpParsingResult.data : null,
  };
}

const VERIFY_EMAIL_INTENT = "verify-email";
const RESEND_VERIFICATION_INTENT = "resend-verification";

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === VERIFY_EMAIL_INTENT) {
    const { token } = await getSessionTokenOrRedirect(request.headers);
    const parsingResult = z
      .object({
        email: z.email(),
        otp: OtpSchema,
      })
      .safeParse(Object.fromEntries(formData));
    if (!parsingResult.success) {
      const parsingErrors = z.treeifyError(parsingResult.error);
      return {
        intent: VERIFY_EMAIL_INTENT,
        success: false,
        errors: {
          email: parsingErrors.properties?.email?.errors?.join(", "),
          otp: parsingErrors.properties?.otp?.errors?.join(", "),
        },
      };
    }

    try {
      const verifyEmailResult = await ethokoCentralClient.verifyEmail({
        token,
        otp: parsingResult.data.otp,
        email: parsingResult.data.email,
      });
      if (verifyEmailResult.variant === "success") {
        return {
          intent: VERIFY_EMAIL_INTENT,
          success: true,
        };
      }
      if (verifyEmailResult.variant === "unprocessable-entity") {
        const errorReason =
          verifyEmailResult.reason === "email-already-verified"
            ? "The email associated with this account is already verified."
            : verifyEmailResult.reason === "invalid-otp"
              ? "The provided code is invalid. Request a new one."
              : verifyEmailResult.reason === "expired-otp"
                ? "The provided code has expired. Request a new one."
                : verifyEmailResult.reason === "unknown"
                  ? "An unknown error occurred."
                  : `Unknown reason ${verifyEmailResult.reason satisfies never}`;
        return {
          intent: VERIFY_EMAIL_INTENT,
          success: false,
          errors: {
            reason: errorReason,
          },
        };
      }
      throw new Error(`Unknown variant ${verifyEmailResult satisfies never}`);
    } catch (error) {
      console.error("Email verification error:", error);
      return {
        intent: VERIFY_EMAIL_INTENT,
        success: false,
        errors: {
          reason: "An error occurred during email verification.",
        },
      };
    }
  }

  if (intent === RESEND_VERIFICATION_INTENT) {
    const parsingResult = z
      .object({
        email: z.email(),
      })
      .safeParse(Object.fromEntries(formData));
    if (!parsingResult.success) {
      const parsingErrors = z.treeifyError(parsingResult.error);
      return {
        intent: RESEND_VERIFICATION_INTENT,
        success: false,
        errors: {
          email: parsingErrors.properties?.email?.errors?.join(", ") ?? null,
        },
      };
    }
    const session = await getSession(request.headers.get("Cookie"));
    const token = session.get("token");
    if (!token) {
      return {
        intent: RESEND_VERIFICATION_INTENT,
        success: false,
        errors: {
          reason: "User is not authenticated.",
        },
      };
    }
    try {
      const resendResult = await ethokoCentralClient.resendVerificationEmail({
        token,
        email: parsingResult.data.email,
      });
      if (resendResult.variant === "success") {
        return {
          intent: RESEND_VERIFICATION_INTENT,
          success: true,
        };
      }
      if (resendResult.variant === "unprocessable-entity") {
        const errorReason =
          resendResult.reason === "email-already-verified"
            ? "The email has already been verified."
            : resendResult.reason === "cooldown-period-not-elapsed"
              ? "A code has been requested recently, please wait before trying again."
              : resendResult.reason === "unknown"
                ? "An unknown error occurred."
                : `Unknown reason ${resendResult.reason satisfies never}`;
        return {
          intent: RESEND_VERIFICATION_INTENT,
          success: false,
          errors: {
            reason: errorReason,
          },
        };
      }
      throw new Error(`Unknown variant ${resendResult satisfies never}`);
    } catch (error) {
      console.error("Resend verification email error:", error);
      return {
        intent: RESEND_VERIFICATION_INTENT,
        success: false,
        errors: {
          reason: "An error occurred while resending the verification email.",
        },
      };
    }
  }
}

export default function VerifyEmail({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  if (actionData?.success) {
    if (actionData?.intent === VERIFY_EMAIL_INTENT) {
      return (
        <main className="flex flex-col items-center justify-center min-h-screen">
          <h1>Email Verified Successfully</h1>
        </main>
      );
    }
    if (actionData?.intent === RESEND_VERIFICATION_INTENT) {
      return (
        <main className="flex flex-col items-center justify-center min-h-screen">
          <h1>Verification Email Resent Successfully</h1>
        </main>
      );
    }
  }
  return (
    <main className="flex flex-col items-center justify-center min-h-screen gap-16">
      <h1>Verify Email</h1>
      <Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="email" value={loaderData.email} />
        {actionData?.errors?.email && (
          <p className="text-red-500">{actionData.errors.email}</p>
        )}
        <input type="hidden" name="intent" value={VERIFY_EMAIL_INTENT} />
        <label>
          OTP:
          <input name="otp" defaultValue={loaderData.otp ?? ""} />
          {actionData?.errors?.otp && (
            <p className="text-red-500">{actionData.errors.otp}</p>
          )}
        </label>
        {actionData?.intent === VERIFY_EMAIL_INTENT &&
          actionData?.errors?.reason && (
            <p className="text-red-500">{actionData.errors.reason}</p>
          )}
        <button type="submit">Verify Email</button>
      </Form>
      <Form method="post" className="flex flex-col gap-4">
        {actionData?.intent === RESEND_VERIFICATION_INTENT &&
          actionData?.errors?.reason && (
            <p className="text-red-500">{actionData.errors.reason}</p>
          )}
        <input type="hidden" name="email" value={loaderData.email} />
        <input type="hidden" name="intent" value={RESEND_VERIFICATION_INTENT} />
        <button type="submit">Resend Verification Email</button>
      </Form>
    </main>
  );
}
