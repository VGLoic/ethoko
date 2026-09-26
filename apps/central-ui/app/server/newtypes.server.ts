import z from "zod";

export const PasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters long.")
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
    (val) => /[!@#$%^&*(),.?":{}|<>]/.test(val),
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
  .length(6, "OTP must be exactly 6 characters long.")
  .refine((val) => /^[0-9]+$/.test(val), "OTP must contain only numbers.");
