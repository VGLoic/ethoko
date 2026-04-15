import { CliError } from "@/client";
import { CommandLogger } from "@/ui";

/**
 * Prompts the user to select one option from a list
 * @param logger The CommandLogger instance to use for prompting the user
 * @param message The message to display to the user
 * @param options The list of options to choose from
 * @param timeoutMs Optional timeout in milliseconds (default: 30000ms = 30s). Set to 0 to disable timeout.
 * @returns The selected option
 * @throws CliError when timeout is reached or user cancels
 */
export async function promptUserSelection<TOptionValue>(
  logger: CommandLogger,
  message: string,
  options: { label: string; value: TOptionValue }[],
  timeoutMs: number = 30_000,
): Promise<TOptionValue> {
  // Use Promise.race for timeout if enabled
  let timeoutHandle: NodeJS.Timeout | null = null;
  const timeoutPromise =
    timeoutMs > 0
      ? new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(
              new CliError(
                `User selection timed out after ${timeoutMs / 1_000}s.`,
              ),
            );
          }, timeoutMs);
        })
      : new Promise<never>(() => {}); // Never resolves if timeout is disabled

  const selectionPromise = logger.prompts
    .select<TOptionValue>({
      message,
      options: options.map((opt) => ({
        value: opt.value,
        label: opt.label,
        // We cast as any because `clack` expects to break the discriminated union of the options to include the label
        // I did not succeed in making that smoothly with typescript
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as any,
    })
    .then((result) => {
      if (logger.prompts.isCancel(result)) {
        throw new CliError("Selection cancelled by user");
      }
      return result;
    })
    .finally(() => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    });

  return await Promise.race([selectionPromise, timeoutPromise]);
}
