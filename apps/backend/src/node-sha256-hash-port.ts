import { createHash } from "node:crypto";
import type { AsyncHashPort } from "@ghostwriter/core";

export function createNodeSha256HashPort(): AsyncHashPort {
  return Object.freeze({
    async digestSha256Hex(canonicalUtf8: string): Promise<string> {
      return createHash("sha256").update(canonicalUtf8, "utf8").digest("hex");
    }
  });
}
