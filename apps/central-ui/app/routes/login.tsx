import { Form, Link, redirect } from "react-router";
import type { Route } from "./+types/login";
import z from "zod";
import { ethokoCentralClient } from "~/server/ethoko-central-api/index.server";
import { PasswordSchema } from "~/server/newtypes.server";
import { centralSession, githubOAuthSession } from "~/server/sessions.server";
import { Feedback, Field, Page, SubmitButton } from "~/components/ui";

export function meta() {
  return [
    { title: "Sign in · Ethoko Central" },
    { name: "description", content: "Sign in to Ethoko Central." },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await centralSession.getSession(
    request.headers.get("Cookie"),
  );
  if (session.has("token")) {
    return redirect("/");
  }

  const queryParams = new URL(request.url).searchParams;
  const error = queryParams.get("error");

  return {
    error,
  };
}

const LOGIN_WITH_EMAIL_INTENT = "login-with-email";
const LOGIN_WITH_GITHUB_INTENT = "login-with-github";

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === LOGIN_WITH_EMAIL_INTENT) {
    const signupRequestParsingResult = z
      .object({
        email: z.email(),
        password: PasswordSchema,
      })
      .safeParse(Object.fromEntries(formData));

    if (!signupRequestParsingResult.success) {
      const errors = z.treeifyError(signupRequestParsingResult.error);
      return {
        intent: LOGIN_WITH_EMAIL_INTENT,
        errors: {
          email: errors.properties?.email?.errors.join(", "),
          password: errors.properties?.password?.errors.join(", "),
        },
      };
    }

    try {
      const loginResult = await ethokoCentralClient.loginWithEmail({
        email: signupRequestParsingResult.data.email,
        password: signupRequestParsingResult.data.password,
      });

      if (loginResult.variant === "success") {
        const session = await centralSession.getSession(
          request.headers.get("Cookie"),
        );
        session.set("token", loginResult.data.token);
        return redirect("/", {
          headers: {
            "Set-Cookie": await centralSession.commitSession(session),
          },
        });
      }
      if (loginResult.variant === "unprocessable-entity") {
        if (loginResult.reason === "invalid-credentials") {
          return {
            intent: LOGIN_WITH_EMAIL_INTENT,
            errors: {
              reason:
                "We couldn’t sign you in. Check your email and password, then try again.",
            },
          };
        }
        if (loginResult.reason === "unknown") {
          throw loginResult.reason;
        }
        throw new Error(
          `unknown variant ${loginResult.reason satisfies never}`,
        );
      }
      throw new Error(`Unknown variant ${loginResult satisfies never}`);
    } catch (error) {
      console.error("Login error:", error);
      return {
        intent: LOGIN_WITH_EMAIL_INTENT,
        errors: {
          reason: "The sign-in service is unavailable. Try again in a moment.",
        },
      };
    }
  } else if (intent === LOGIN_WITH_GITHUB_INTENT) {
    const githubLoginResult = await ethokoCentralClient.startLoginWithGitHub();
    if (githubLoginResult.variant !== "success") {
      throw new Error(
        `GitHub login failed: ${githubLoginResult.reason ?? "unknown"}`,
      );
    }
    const session = await githubOAuthSession.getSession(
      request.headers.get("Cookie"),
    );
    session.set("state", githubLoginResult.data.state);
    return redirect(githubLoginResult.data.authUrl, {
      headers: {
        "Set-Cookie": await githubOAuthSession.commitSession(session),
      },
    });
  } else {
    throw new Error(`Unknown intent: ${intent}`);
  }
}

export default function Login({
  actionData,
  loaderData,
}: Route.ComponentProps) {
  return (
    <Page>
      <Feedback>{loaderData?.error}</Feedback>
      <h1>Sign in to Ethoko Central</h1>
      <Link to="/forgot-password">Forgot password?</Link>
      <Form method="post">
        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          required
          error={actionData?.errors?.email}
        />
        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          error={actionData?.errors?.password}
        />
        <input type="hidden" name="intent" value={LOGIN_WITH_EMAIL_INTENT} />
        <Feedback>{actionData?.errors?.reason}</Feedback>
        <SubmitButton
          intent={LOGIN_WITH_EMAIL_INTENT}
          pendingLabel="Signing in…"
        >
          Sign in
        </SubmitButton>
      </Form>
      <Form method="post">
        <input type="hidden" name="intent" value={LOGIN_WITH_GITHUB_INTENT} />
        <SubmitButton
          intent={LOGIN_WITH_GITHUB_INTENT}
          secondary
          pendingLabel="Connecting…"
        >
          Sign in with GitHub
        </SubmitButton>
      </Form>
    </Page>
  );
}
