import z from "zod";
import { config } from "~/server/config.server";

const UserResponseSchema = z.object({
  email: z.email(),
  handle: z.string(),
  emailVerified: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
type UserResponse = z.infer<typeof UserResponseSchema>;

const LoginResponseSchema = z.object({
  token: z.string(),
});
type LoginResponse = z.infer<typeof LoginResponseSchema>;

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
  constructor(private baseUrl: string) {}

  private createBffHeaders(params?: { userSessionToken?: string }): HeadersInit {
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

  // private async handleUnprocessableEntityResponse(response: Response, errorCodeMapping: Record<string, TTUnprocessableEntityReason>)

  async signup(signupRequest: {
    email: string;
    password: string;
    handle: string;
  }): Promise<
    ApiResult<
      UserResponse,
      "email-already-registered" | "handle-already-registered"
    >
  > {
    const response = await fetch(`${this.baseUrl}/auth/signup/email`, {
      method: "POST",
      headers: this.createBffHeaders(),
      body: JSON.stringify(signupRequest),
    });
    return await this.handleResponse(response, UserResponseSchema, {
      ETKAS01: "email-already-registered",
      ETKAS02: "handle-already-registered",
    });
  }

  async login(loginRequest: {
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
