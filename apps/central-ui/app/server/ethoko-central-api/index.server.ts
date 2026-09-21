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

class EthokoCentralClient {
  constructor(private baseUrl: string) {}

  async signup(signupRequest: {
    email: string;
    password: string;
    handle: string;
  }): Promise<UserResponse> {
    const response = await fetch(`${this.baseUrl}/auth/signup/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(signupRequest),
    });
    if (!response.ok) {
      throw new Error(`Failed to sign up: ${response.statusText}`);
    }
    const data = await response.json();
    return UserResponseSchema.parse(data);
  }

  async login(loginRequest: {
    email: string;
    password: string;
  }): Promise<LoginResponse> {
    const response = await fetch(`${this.baseUrl}/auth/login/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(loginRequest),
    });
    if (!response.ok) {
      throw new Error(`Failed to log in: ${response.statusText}`);
    }
    const data = await response.json();
    const parsedData = LoginResponseSchema.parse(data);
    return parsedData;
  }

  async me(params: { token: string }): Promise<UserResponse> {
    const response = await fetch(`${this.baseUrl}/auth/me`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.token}`,
      },
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
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.token}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Failed to log out: ${response.statusText}`);
    }
  }

  async verifyEmail(params: {
    token: string;
    otp: string;
    email: string;
  }): Promise<void> {
    const response = await fetch(`${this.baseUrl}/auth/verify-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.token}`,
      },
      body: JSON.stringify({ otp: params.otp, email: params.email }),
    });
    if (!response.ok) {
      throw new Error(`Failed to verify email: ${response.statusText}`);
    }
  }

  async resendVerificationEmail(params: {
    token: string;
    email: string;
  }): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/auth/resend-verification-otp`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${params.token}`,
        },
        body: JSON.stringify({ email: params.email }),
      },
    );
    if (!response.ok) {
      throw new Error(
        `Failed to resend verification email: ${response.statusText}`,
      );
    }
  }
}

export const ethokoCentralClient = new EthokoCentralClient(
  config.ETHOKO_CENTRAL_URL,
);
