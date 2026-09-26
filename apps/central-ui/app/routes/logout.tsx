import { getSession, destroySession } from "~/server/sessions.server";
import type { Route } from "./+types/logout";
import { redirect } from "react-router";
import { ethokoCentralClient } from "~/server/ethoko-central-api/index.server";

export async function action({ request }: Route.ActionArgs) {
  const session = await getSession(request.headers.get("Cookie"));

  const token = session.get("token");
  if (!token) {
    return redirect("/login", {
      headers: { "Set-Cookie": await destroySession(session) },
    });
  }

  try {
    await ethokoCentralClient.logout({ token });
  } catch (error) {
    console.error("Error during logout:", error);
  }

  return redirect("/login", {
    headers: { "Set-Cookie": await destroySession(session) },
  });
}
