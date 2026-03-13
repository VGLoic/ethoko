import { styleText } from "node:util";
import { LOG_COLORS } from "@/cli-ui/utils";

export function toAsyncResult<T, TError = Error>(
  promise: Promise<T>,
  opts: {
    debug?: boolean;
  } = {},
): Promise<{ success: true; value: T } | { success: false; error: TError }> {
  return promise
    .then((value) => ({ success: true as const, value }))
    .catch((error) => {
      if (opts.debug) {
        console.error(styleText(LOG_COLORS.error, "[Debug error] - "), error);
      }
      return { success: false as const, error };
    });
}

export function toResult<T, TError = Error>(
  fn: () => T,
  opts: {
    debug?: boolean;
  } = {},
): { success: true; value: T } | { success: false; error: TError } {
  try {
    const value = fn();
    return { success: true, value };
  } catch (error) {
    if (opts.debug) {
      console.error(styleText(LOG_COLORS.error, "[Debug error] - "), error);
    }
    return { success: false as const, error: error as TError };
  }
}
