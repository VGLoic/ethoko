import z from "zod";
import crypto from "crypto";
import { SolcJsonInputSchema } from "./solc-artifacts-schemas/v0.8.33/input-json";

/**
 * We initialize a sha256 hash.
 * For each input source and compiler settings
 * - we update the hash with the key and content
 * We finalize the hash, encode it as hex and returns the first 12 characters as the artifact ID.
 * @param input
 */
export function deriveEthokoArtifactId(
  input: z.infer<typeof SolcJsonInputSchema>,
): string {
  const hash = crypto.createHash("sha256");
  const sortedSourceKeys = Object.keys(input.sources).sort();
  for (const sourceKey of sortedSourceKeys) {
    const source = input.sources[sourceKey];
    hash.update(sourceKey);
    hash.update(JSON.stringify(source));
  }
  if (input.settings) {
    hash.update(JSON.stringify(input.settings));
  }
  return hash.digest("hex").slice(0, 12);
}
