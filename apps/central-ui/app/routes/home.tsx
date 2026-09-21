import type { Route } from "./+types/home";
import { getSession } from "~/server/sessions.server";
import { ethokoCentralClient } from "~/server/ethoko-central-api/index.server";
import { Form, redirect } from "react-router";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "Ethoko Central Home" },
    { name: "description", content: "Welcome to Ethoko Central!" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSession(request.headers.get("Cookie"));

  const token = session.get("token");
  if (!token) {
    return redirect("/login");
  }

  const user = await ethokoCentralClient.me({ token });

  if (!user) {
    return redirect("/login");
  }

  return { user };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <main className="flex flex-col items-center justify-center pt-16 pb-4 gap-16">
      <div className="flex flex-col items-center gap-8">
        <div className="flex flex-row items-center gap-4">
          <div className="font-bold">Email:</div>
          <div>{loaderData.user.email}</div>
        </div>
        <div className="flex flex-row items-center gap-4">
          <div className="font-bold">Handle:</div>
          <div>{loaderData.user.handle}</div>
        </div>
        <div className="flex flex-row items-center gap-4">
          <div className="font-bold">Email Verified:</div>
          <div>{loaderData.user.emailVerified ? "Yes" : "No"}</div>
        </div>
      </div>
      <div>
        <Form method="post" action="/logout">
          <button type="submit">Logout</button>
        </Form>
      </div>
    </main>
  );
}
