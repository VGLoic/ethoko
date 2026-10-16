import { Form, redirect, useSearchParams } from "react-router";
import { MoodPrototype } from "~/components/mood-prototype";
import type { Route } from "./+types/login";
import z from "zod";
import { ethokoCentralClient } from "~/server/ethoko-central-api/index.server";
import { PasswordSchema } from "~/server/newtypes.server";
import { centralSession, githubOAuthSession } from "~/server/sessions.server";

export function meta() {
  return [
    { title: "Log In" },
    { name: "description", content: "Log in to Ethoko Central!" },
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
              reason: "Invalid email or password",
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
          reason: "An error occurred during login.",
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
  const [searchParams] = useSearchParams();
  if (import.meta.env.DEV && searchParams.has("variant")) {
    return <MoodPrototype />;
  }
  return (
    <main className="flex flex-col pt-16 pb-4 px-8 gap-8">
      {loaderData?.error ? (
        <p className="text-red-500">{loaderData.error}</p>
      ) : null}
      <h1 className="flex justify-center">Log In to Ethoko Central</h1>
      <Form method="post" className="flex flex-col gap-4">
        <label>
          Email:
          <input type="email" name="email" required className="border p-2" />
          {actionData?.intent === LOGIN_WITH_EMAIL_INTENT &&
          actionData?.errors?.email ? (
            <p className="text-red-500">{actionData.errors.email}</p>
          ) : null}
        </label>
        <label>
          Password:
          <input
            type="password"
            name="password"
            required
            className="border p-2"
          />
          <input type="hidden" name="intent" value={LOGIN_WITH_EMAIL_INTENT} />
          {actionData?.errors?.password ? (
            <p className="text-red-500">{actionData.errors.password}</p>
          ) : null}
        </label>
        {actionData?.intent === LOGIN_WITH_EMAIL_INTENT &&
        actionData?.errors?.reason ? (
          <p className="text-red-500">{actionData.errors.reason}</p>
        ) : null}
        <button type="submit">Log In</button>
      </Form>
      <Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="intent" value={LOGIN_WITH_GITHUB_INTENT} />
        <button type="submit">Log In with GitHub</button>
      </Form>
    </main>
  );
}
