# Examples: cli-beacon Code Patterns

## Client method skeleton

```typescript
// src/client/do-something.ts
import { z } from "zod";

import { CliError } from "@/client/error";
import type { StorageProvider } from "@/storage-provider";
import type { PulledArtifactStore } from "@/pulled-artifact-store";
import type { CommandLogger } from "@/ui";
import { toAsyncResult } from "@/utils/result";

/**
 * Does something useful.
 * @throws {CliError} When the operation fails.
 */
export async function doSomething(
  project: string,
  storageProvider: StorageProvider,
  pulledArtifactStore: PulledArtifactStore,
  opts: { force: boolean; debug: boolean; logger: CommandLogger },
): Promise<DoSomethingResult> {
  const steps = opts.logger.createSpinner("Doing something...");

  const result = await toAsyncResult(storageProvider.listTags(project), {
    debug: opts.debug,
  });
  if (!result.success) {
    steps.fail("Failed to do something");
    throw new CliError(
      "Could not complete the operation. Check your configuration.",
    );
  }

  if (opts.debug) {
    opts.logger.message(`Found ${result.value.length} items`);
  }

  steps.succeed("Done");
  return { items: result.value };
}

type DoSomethingResult = { items: string[] };
```

## Command handler skeleton

```typescript
// src/commands/do-something.ts
import type { Command } from "commander";
import { z } from "zod";

import { doSomething, CliError } from "@/client";
import type { EthokoCliConfig } from "@/config";
import { PulledArtifactStore } from "@/pulled-artifact-store";
import { CommandLogger } from "@/ui";
import { toAsyncResult } from "@/utils/result";

import { ProjectOrArtifactKeySchema } from "./utils/parse-project-or-artifact-key";
import { createStorageProvider } from "./utils/storage-provider";

export function registerDoSomethingCommand(
  program: Command,
  getConfig: () => Promise<EthokoCliConfig>,
): void {
  program
    .command("do-something")
    .description("Does something useful")
    .argument("<project>", "project name or artifact key (PROJECT[:TAG|@ID])")
    .option("--force", "overwrite existing data", false)
    .option("--silent", "suppress output", false)
    .option("--debug", "enable debug output", false)
    .action(async (projectArg: string, options: Record<string, unknown>) => {
      const logger = new CommandLogger(options.silent as boolean);

      // Load config
      const configResult = await toAsyncResult(getConfig());
      if (!configResult.success) {
        logger.error("Failed to load configuration.");
        process.exitCode = 1;
        return;
      }
      const config = configResult.value;

      // Parse argument
      const keyResult = ProjectOrArtifactKeySchema.safeParse(projectArg);
      if (!keyResult.success) {
        logger.error(z.prettifyError(keyResult.error));
        process.exitCode = 1;
        return;
      }

      const projectConfig = config.getProjectConfig(keyResult.data.project);
      if (!projectConfig) {
        logger.error(
          `Project "${keyResult.data.project}" not found in configuration.`,
        );
        process.exitCode = 1;
        return;
      }

      logger.intro(`Doing something for ${keyResult.data.project}`);

      const storageProvider = createStorageProvider(projectConfig);
      const pulledArtifactStore = new PulledArtifactStore(
        config.pulledArtifactsPath,
      );

      await doSomething(
        keyResult.data.project,
        storageProvider,
        pulledArtifactStore,
        {
          force: options.force as boolean,
          debug: options.debug as boolean,
          logger,
        },
      )
        .then((result) => {
          logger.success(`Processed ${result.items.length} items`);
          logger.outro("Done");
        })
        .catch((err) => {
          if (err instanceof CliError) {
            logger.error(err.message);
          } else {
            logger.error(
              "An unexpected error occurred. Re-run with --debug for details.",
            );
            console.error(err);
          }
          process.exitCode = 1;
        });
    });
}
```

## E2E test skeleton

```typescript
// test/e2e/do-something.e2e.test.ts
import { describe, expect } from "vitest";

import { doSomething } from "@/client";
import { CommandLogger } from "@/ui";

import {
  ARTIFACTS_STRATEGIES,
  STORAGE_PROVIDER_STRATEGIES,
} from "@test/helpers/artifacts-strategy";
import { storageProviderTest } from "@test/helpers/storage-provider-test";
import { createTestProjectName } from "@test/helpers/test-utils";

describe.for(STORAGE_PROVIDER_STRATEGIES)(
  "do-something ($name)",
  ({ storageProviderFactory }) => {
    storageProviderTest.scoped({ storageProviderFactory });

    storageProviderTest.for([...ARTIFACTS_STRATEGIES] as const)(
      "does something with $name",
      async ({ storageProvider, pulledArtifactStore, push }) => {
        const projectName = createTestProjectName("do-something");
        const logger = new CommandLogger(true); // silent

        // Push test data first
        await push(projectName);

        // Test the client method
        const result = await doSomething(
          projectName,
          storageProvider,
          pulledArtifactStore,
          {
            force: false,
            debug: false,
            logger,
          },
        );

        expect(result.items).toBeDefined();
        expect(result.items.length).toBeGreaterThan(0);
      },
    );
  },
);
```

## Zod schema + safeParse pattern

```typescript
import { z } from "zod";

// Define schema with PascalCase + Schema suffix
const MyInputSchema = z.object({
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
});

// Infer type from schema
type MyInput = z.infer<typeof MyInputSchema>;

// User input: always safeParse
const result = MyInputSchema.safeParse(userInput);
if (!result.success) {
  logger.error(z.prettifyError(result.error));
  process.exitCode = 1;
  return;
}
const validated: MyInput = result.data;

// Trusted/internal data: parse is acceptable
const trusted = MyInputSchema.parse(internalData);
```

## Storage provider implementation outline

```typescript
// src/storage-provider/my-provider.ts
import type {
  StorageProvider,
  UploadArtifactParams,
  DownloadResult,
} from "./storage-provider.interface";

export class MyStorageProvider implements StorageProvider {
  constructor(private readonly config: MyProviderConfig) {}

  async listTags(project: string): Promise<string[]> {
    /* ... */
  }
  async listIds(project: string): Promise<string[]> {
    /* ... */
  }
  async hasArtifactByTag(project: string, tag: string): Promise<boolean> {
    /* ... */
  }
  async hasArtifactById(project: string, id: string): Promise<boolean> {
    /* ... */
  }
  async uploadArtifact(params: UploadArtifactParams): Promise<void> {
    /* ... */
  }
  async downloadArtifactByTag(
    project: string,
    tag: string,
  ): Promise<DownloadResult> {
    /* ... */
  }
  async downloadArtifactById(
    project: string,
    id: string,
  ): Promise<DownloadResult> {
    /* ... */
  }
  // ... remaining interface methods
}
```

## Supported origin implementation outline

```typescript
// src/supported-origins/my-origin/schemas.ts
import { z } from "zod";

export const MyOriginArtifactSchema = z.object({
  // Define the shape of compilation artifacts from this origin
});
export type MyOriginArtifact = z.infer<typeof MyOriginArtifactSchema>;

// src/supported-origins/my-origin/infer-artifact.ts
import type { MyOriginArtifact } from "./schemas";

/**
 * Attempts to identify artifacts as coming from this origin.
 * Returns null if the artifact does not match.
 */
export function inferMyOriginArtifact(raw: unknown): MyOriginArtifact | null {
  const result = MyOriginArtifactSchema.safeParse(raw);
  return result.success ? result.data : null;
}

// src/supported-origins/my-origin/map-to-ethoko-artifact.ts
import type { EthokoInputArtifact } from "@/ethoko-artifacts/v0";
import type { MyOriginArtifact } from "./schemas";

export function mapMyOriginToEthokoArtifact(
  artifact: MyOriginArtifact,
): EthokoInputArtifact {
  return {
    // Map fields to Ethoko artifact format
  };
}
```

## Import ordering example

```typescript
// 1. Built-in modules
import fs from "node:fs/promises";
import path from "node:path";

// 2. Third-party packages
import { Command } from "commander";
import { z } from "zod";

// 3. Internal modules (cross-directory via @/ alias)
import { CliError } from "@/client/error";
import type { StorageProvider } from "@/storage-provider";
import { LOG_COLORS } from "@/ui";
import { toAsyncResult } from "@/utils/result";

// 4. Same-directory imports (relative ./)
import { helperFunction } from "./helper";
```
