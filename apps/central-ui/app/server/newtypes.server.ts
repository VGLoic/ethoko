import z from "zod";

// Rust str::trim uses Unicode White_Space, unlike JavaScript trim (notably U+0085/U+FEFF).
export function trimPasswordInput(value: string): string {
  return value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
}

export const PasswordSchema = z
  .string()
  .transform(trimPasswordInput)
  .refine(
    (val) => new TextEncoder().encode(val).length >= 8,
    "Password must be at least 8 UTF-8 bytes long.",
  )
  // Minimum 1 upercase
  .refine(
    (val) => /[A-Z]/.test(val),
    "Password must contain at least one uppercase letter.",
  )
  // Minimum 1 lowercase
  .refine(
    (val) => /[a-z]/.test(val),
    "Password must contain at least one lowercase letter.",
  )
  // Minimum 1 number
  .refine(
    (val) => /[0-9]/.test(val),
    "Password must contain at least one number.",
  )
  // Minimum 1 special character
  .refine(
    (val) => /[^a-zA-Z0-9]/.test(val),
    "Password must contain at least one special character.",
  );

export const HandleSchema = z
  .string()
  .min(4, "Handle must be at least 4 characters long.")
  .max(30, "Handle must be at most 30 characters long.")
  .refine(
    (val) => /^[a-zA-Z0-9-]+$/.test(val),
    "Handle can only contain letters, numbers, and hyphens.",
  );

export const OtpSchema = z
  .string()
  .length(6, "Enter the 6-digit verification code from your email.")
  .refine(
    (val) => /^[0-9]+$/.test(val),
    "The verification code must contain only numbers.",
  );
