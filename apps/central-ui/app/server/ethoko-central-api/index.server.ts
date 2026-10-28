import z from "zod";
import { config } from "~/server/config.server";

const PendingUserResponseSchema = z.object({
  state: z.literal("pending"),
  email: z.email(),
  suggestedHandle: z.string().nullable().optional(),
  emailVerified: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const RegisteredUserResponseSchema = z.object({
  state: z.literal("registered"),
  email: z.email(),
  handle: z.string(),
  emailVerified: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const UserResponseSchema = z.discriminatedUnion("state", [
  PendingUserResponseSchema,
  RegisteredUserResponseSchema,
]);
type UserResponse = z.infer<typeof UserResponseSchema>;

const SignupResponseSchema = z.object({
  email: z.email(),
  emailVerified: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
type SignupResponse = z.infer<typeof SignupResponseSchema>;

const LoginResponseSchema = z.object({
  token: z.string(),
});
type LoginResponse = z.infer<typeof LoginResponseSchema>;

const LoginGithubStartResponseSchema = z.object({
  authUrl: z.string(),
  state: z.string(),
});
type LoginGithubStartResponse = z.infer<typeof LoginGithubStartResponseSchema>;

const LoginGithubExchangeResponseSchema = z.object({
  token: z.string(),
});
type LoginGithubExchangeResponse = z.infer<
  typeof LoginGithubExchangeResponseSchema
>;

const UnprocessableEntityErrorSchema = z.object({
  code: z.string(),
  reason: z.string(),
});

type ApiResult<TData, TUnprocessableEntityReason> =
  | {
      variant: "success";
      data: TData;
    }
  | {
      variant: "unprocessable-entity";
      reason: TUnprocessableEntityReason | "unknown";
    };

class EthokoCentralClient {
  async forgotPassword(params: {
    email: string;
  }): Promise<
    ApiResult<{ message: string; cooldownSeconds: number }, "unknown">
  > {
    const response = await fetch(`${this.baseUrl}/auth/forgot-password`, {
      method: "POST",
      headers: this.createBffHeaders(),
      body: JSON.stringify(params),
    });
    return this.handleResponse(
      response,
      z.object({
        message: z.string(),
        cooldownSeconds: z.number().int().nonnegative(),
      }),
      {},
    );
  }

  async resetPassword(params: {
    token: string;
    password: string;
  }): Promise<ApiResult<null, "invalid-token">> {
    const response = await fetch(`${this.baseUrl}/auth/reset-password`, {
      method: "POST",
      headers: this.createBffHeaders(),
      body: JSON.stringify(params),
    });
    return this.handleResponse(response, null, { ETKARP01: "invalid-token" });
  }
  constructor(private baseUrl: string) {}

  private createBffHeaders(params?: {
    userSessionToken?: string;
  }): HeadersInit {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.CENTRAL_UI_BFF_SHARED_SECRET}`,
      ...(params?.userSessionToken
        ? {
            "X-Ethoko-User-Authorization": `Bearer ${params.userSessionToken}`,
          }
        : {}),
    };
  }

  private async handleResponse<
    TData,
    TSchema extends z.ZodType<TData> | null,
    TTUnprocessableEntityReason,
  >(
    response: Response,
    schema: TSchema,
    errorCodeMapping: Record<string, TTUnprocessableEntityReason>,
  ): Promise<
    ApiResult<
      TSchema extends z.ZodType<unknown> ? TData : null,
      TTUnprocessableEntityReason | "unknown"
    >
  > {
    if (!response.ok) {
      if (response.status !== 422) {
        throw response.statusText;
      }
      const data = await response.json();
      const parsingResult = UnprocessableEntityErrorSchema.safeParse(data);
      if (!parsingResult.success) {
        throw parsingResult.error;
      }
      return {
        variant: "unprocessable-entity",
        reason: errorCodeMapping[parsingResult.data.code] ?? "unknown",
      };
    }
    if (!schema) {
      return {
        variant: "success",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: null as any,
      };
    }
    const data = await response.json();
    const parsingResult = schema.safeParse(data);
    if (!parsingResult.success) {
      throw parsingResult.error;
    }
    return {
      variant: "success",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: parsingResult.data as any,
    };
  }

  async signup(signupRequest: {
    email: string;
    password: string;
  }): Promise<ApiResult<SignupResponse, "email-already-registered">> {
    const response = await fetch(`${this.baseUrl}/auth/signup/email`, {
      method: "POST",
      headers: this.createBffHeaders(),
      body: JSON.stringify(signupRequest),
    });
    return await this.handleResponse(response, SignupResponseSchema, {
      ETKAS01: "email-already-registered",
    });
  }

  async registerHandle(params: {
    token: string;
    handle: string;
  }): Promise<
    ApiResult<
      UserResponse,
      "handle-already-registered" | "already-registered" | "invalid-handle"
    >
  > {
    const response = await fetch(`${this.baseUrl}/auth/register-handle`, {
      method: "POST",
      headers: this.createBffHeaders({ userSessionToken: params.token }),
      body: JSON.stringify({ handle: params.handle }),
    });
    return await this.handleResponse(response, UserResponseSchema, {
      ETKARH01: "handle-already-registered",
      ETKARH02: "already-registered",
      ETKARH03: "invalid-handle",
    });
  }

  async loginWithEmail(loginRequest: {
    email: string;
    password: string;
  }): Promise<ApiResult<LoginResponse, "invalid-credentials">> {
    const response = await fetch(`${this.baseUrl}/auth/login/email`, {
      method: "POST",
      headers: this.createBffHeaders(),
      body: JSON.stringify(loginRequest),
    });
    return await this.handleResponse(response, LoginResponseSchema, {
      ETKAL01: "invalid-credentials",
    });
  }

  async startLoginWithGitHub(): Promise<
    ApiResult<LoginGithubStartResponse, "unknown">
  > {
    const response = await fetch(`${this.baseUrl}/auth/login/github/start`, {
      method: "POST",
      headers: this.createBffHeaders(),
    });
    return await this.handleResponse(
      response,
      LoginGithubStartResponseSchema,
      {},
    );
  }

  async exchangeCodeForToken(exchangeRequest: {
    code: string;
    state: string;
  }): Promise<
    ApiResult<
      LoginGithubExchangeResponse,
      | "primary-email-collision"
      | "oauth-transaction-not-found"
      | "oauth-transaction-expired"
    >
  > {
    const response = await fetch(`${this.baseUrl}/auth/login/github/callback`, {
      method: "POST",
      headers: this.createBffHeaders(),
      body: JSON.stringify(exchangeRequest),
    });
    return await this.handleResponse(
      response,
      LoginGithubExchangeResponseSchema,
      {
        ETKLGC01: "primary-email-collision",
        ETKLGC02: "oauth-transaction-not-found",
        ETKLGC03: "oauth-transaction-expired",
      },
    );
  }

  async me(params: { token: string }): Promise<UserResponse> {
    const response = await fetch(`${this.baseUrl}/auth/me`, {
      method: "GET",
      headers: this.createBffHeaders({ userSessionToken: params.token }),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch user: ${response.statusText}`);
    }
    const data = await response.json();
    return UserResponseSchema.parse(data);
  }

  async logout(params: { token: string }): Promise<void> {
    const response = await fetch(`${this.baseUrl}/auth/logout`, {
      method: "POST",
      headers: this.createBffHeaders({ userSessionToken: params.token }),
    });
    if (!response.ok) {
      throw new Error(`Failed to log out: ${response.statusText}`);
    }
  }

  async verifyEmail(params: {
    otp: string;
    email: string;
  }): Promise<
    ApiResult<null, "email-already-verified" | "invalid-otp" | "expired-otp">
  > {
    const response = await fetch(`${this.baseUrl}/auth/verify-email`, {
      method: "POST",
      headers: this.createBffHeaders(),
      body: JSON.stringify({ otp: params.otp, email: params.email }),
    });
    return await this.handleResponse(response, null, {
      ETKAVE01: "email-already-verified",
      ETKAVE02: "invalid-otp",
      ETKAVE03: "expired-otp",
    });
  }

  async resendVerificationEmail(params: {
    email: string;
  }): Promise<
    ApiResult<null, "email-already-verified" | "cooldown-period-not-elapsed">
  > {
    const response = await fetch(
      `${this.baseUrl}/auth/resend-verification-otp`,
      {
        method: "POST",
        headers: this.createBffHeaders(),
        body: JSON.stringify({ email: params.email }),
      },
    );
    return await this.handleResponse(response, null, {
      ETKARV01: "email-already-verified",
      ETKARV02: "cooldown-period-not-elapsed",
    });
  }
}

export const ethokoCentralClient = new EthokoCentralClient(
  config.ETHOKO_CENTRAL_URL,
);
