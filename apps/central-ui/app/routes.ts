import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("signup", "routes/signup.tsx"),
  route("register-handle", "routes/register-handle.tsx"),
  route("login", "routes/login.tsx"),
  route("forgot-password", "routes/forgot-password.tsx"),
  route("reset-password", "routes/reset-password.tsx"),
  route("logout", "routes/logout.tsx"),
  route("verify-email", "routes/verify-email.tsx"),
  route("auth/github/callback", "routes/github-auth-callback.ts"),
] satisfies RouteConfig;
