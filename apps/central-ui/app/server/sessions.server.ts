import { createCookieSessionStorage } from "react-router";
import { config } from "./config.server";

type SessionData = {
  token: string;
};

const { getSession, commitSession, destroySession } =
  createCookieSessionStorage<SessionData>({
    cookie: {
      name: "__session",
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      // 55 minutes
      maxAge: 55 * 60,
      secrets: [config.SESSION_SECRET],
      secure: config.NODE_ENV === "production",
    },
  });

export { getSession, commitSession, destroySession };
