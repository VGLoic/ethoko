import { createCookieSessionStorage } from "react-router";
import { config } from "./config.server";

type SessionData = {
  token: string;
};

const centralStorage = createCookieSessionStorage<SessionData>({
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

export const centralSession = {
  getSession: centralStorage.getSession,
  commitSession: centralStorage.commitSession,
  destroySession: centralStorage.destroySession,
};

type GithubSessionData = {
  state: string;
};

const githubOAuthStorage = createCookieSessionStorage<GithubSessionData>({
  cookie: {
    name: "__github_oauth_session",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    // 10 minutes
    maxAge: 10 * 60,
    secrets: [config.SESSION_SECRET],
    secure: config.NODE_ENV === "production",
  },
});

export const githubOAuthSession = {
  getSession: githubOAuthStorage.getSession,
  commitSession: githubOAuthStorage.commitSession,
  destroySession: githubOAuthStorage.destroySession,
};
