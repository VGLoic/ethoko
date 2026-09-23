import { Form, redirect } from "react-router";
import type { Route } from "./+types/login";
import z from "zod";
import { ethokoCentralClient } from "~/server/ethoko-central-api/index.server";
import { PasswordSchema } from "~/server/newtypes.server";
import { commitSession, getSession } from "~/server/sessions.server";

export function meta() {
  return [
    { title: "Log In" },
    { name: "description", content: "Log in to Ethoko Central!" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSession(request.headers.get("Cookie"));
  if (session.has("token")) {
    return redirect("/");
  }

  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const session = await getSession(request.headers.get("Cookie"));
  const formData = await request.formData();

  const signupRequestParsingResult = z
    .object({
      email: z.email(),
      password: PasswordSchema,
    })
    .safeParse(Object.fromEntries(formData));

  if (!signupRequestParsingResult.success) {
    const errors = z.treeifyError(signupRequestParsingResult.error);
    return {
      errors: {
        email: errors.properties?.email?.errors.join(", "),
        password: errors.properties?.password?.errors.join(", "),
      },
    };
  }

  try {
    const loginResult = await ethokoCentralClient.login({
      email: signupRequestParsingResult.data.email,
      password: signupRequestParsingResult.data.password,
    });

    if (loginResult.variant === "success") {
      session.set("token", loginResult.data.token);
      return redirect("/", {
        headers: { "Set-Cookie": await commitSession(session) },
      });
    }
    if (loginResult.variant === "unprocessable-entity") {
      if (loginResult.reason === "invalid-credentials") {
        return {
          errors: {
            reason: "Invalid email or password",
          },
        };
      }
      if (loginResult.reason === "unknown") {
        throw loginResult.reason;
      }
      throw new Error(`unknown variant ${loginResult.reason satisfies never}`);
    }
    throw new Error(`Unknown variant ${loginResult satisfies never}`);
  } catch (error) {
    console.error("Login error:", error);
    return {
      errors: {
        reason: "An error occurred during login.",
      },
    };
  }
}

export default function Login({ actionData }: Route.ComponentProps) {
  return (
    <main className="flex flex-col pt-16 pb-4 px-8 gap-8">
      <h1 className="flex justify-center">Log In to Ethoko Central</h1>
      <Form method="post" className="flex flex-col gap-4">
        <label>
          Email:
          <input type="email" name="email" required className="border p-2" />
          {actionData?.errors?.email ? (
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
          {actionData?.errors?.password ? (
            <p className="text-red-500">{actionData.errors.password}</p>
          ) : null}
        </label>
        {actionData?.errors?.reason ? (
          <p className="text-red-500">{actionData.errors.reason}</p>
        ) : null}
        <button type="submit">Log In</button>
      </Form>
    </main>
  );
}
