import { styleText } from "node:util";
import * as clackPrompts from "@clack/prompts";

export const LOG_COLORS = {
  log: "cyan",
  success: "green",
  error: "red",
  warn: "yellow",
} as const;

/**
 * CLI UI utilities for enhanced terminal output
 */

interface Spinner {
  // Displays a success message and stops the spinner
  succeed: (message: string) => void;
  // Displays a warning message and stops the spinner
  warn: (message: string) => void;
  // Displays an error message and stops the spinner
  fail: (message: string) => void;
  // Stops the spinner without displaying a message, can be used with {succeed, warn, fail} afterwards to display a message
  stop: () => void;
}

export class CommandLogger {
  public silent: boolean;
  private active: boolean = false;

  public prompts = {
    select: clackPrompts.select,
    isCancel: clackPrompts.isCancel,
    cancel: clackPrompts.cancel,
    confirm: clackPrompts.confirm,
    text: clackPrompts.text,
    password: clackPrompts.password,
  };

  constructor(silent = false) {
    this.silent = silent;
  }

  public createSpinner(message: string): Spinner {
    if (this.silent) {
      return {
        succeed: () => {},
        warn: () => {},
        fail: () => {},
        stop: () => {},
      };
    }
    const spinner = clackPrompts.spinner({ output: process.stderr });
    spinner.start(message);
    return {
      succeed: (msg: string) => spinner.stop(msg),
      warn: (msg: string) => spinner.error(msg),
      fail: (msg: string) => spinner.cancel(msg),
      stop: () => spinner.clear(),
    };
  }

  public intro(message: string): CommandLogger {
    if (!this.silent) {
      clackPrompts.intro(message, { output: process.stderr });
    }
    this.active = true;
    return this;
  }

  public outro(message?: string): CommandLogger {
    if (!this.silent) {
      clackPrompts.outro(message, { output: process.stderr });
    }
    return this;
  }

  public error(message: string): CommandLogger {
    if (!this.silent) {
      if (!this.active) {
        console.error(styleText(LOG_COLORS.error, `✖ ${message}`));
      } else {
        clackPrompts.log.error(message, { output: process.stderr });
      }
    }
    return this;
  }

  public info(message: string): CommandLogger {
    if (!this.silent) {
      if (!this.active) {
        console.error(styleText(LOG_COLORS.log, `ℹ ${message}`));
      } else {
        clackPrompts.log.message(message, { output: process.stderr });
      }
    }
    return this;
  }

  public warn(message: string): CommandLogger {
    if (!this.silent) {
      if (!this.active) {
        console.error(styleText(LOG_COLORS.warn, `⚠ ${message}`));
      } else {
        clackPrompts.log.warn(message, { output: process.stderr });
      }
    }
    return this;
  }

  public success(message: string): CommandLogger {
    if (!this.silent) {
      if (!this.active) {
        console.error(styleText(LOG_COLORS.success, `✔ ${message}`));
      } else {
        clackPrompts.log.success(message, { output: process.stderr });
      }
    }
    return this;
  }

  public message(message: string): CommandLogger {
    if (!this.silent) {
      if (!this.active) {
        console.error(styleText(LOG_COLORS.log, `ℹ ${message}`));
      } else {
        clackPrompts.log.message(message, { output: process.stderr });
      }
    }
    return this;
  }

  public cancel(message: string): CommandLogger {
    if (!this.silent) {
      if (!this.active) {
        console.error(styleText(LOG_COLORS.error, `✖ ${message}`));
      } else {
        clackPrompts.cancel(message, { output: process.stderr });
      }
    }
    return this;
  }

  public note(content: string, title?: string): CommandLogger {
    if (this.silent) return this;
    clackPrompts.note(content, title, {
      output: process.stderr,
    });
    return this;
  }
}
