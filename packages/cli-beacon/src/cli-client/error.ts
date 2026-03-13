/**
 * Custom error class for CLI errors.
 * Message is meant to be user-friendly and can be directly shown to the user.
 */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
  }
}
