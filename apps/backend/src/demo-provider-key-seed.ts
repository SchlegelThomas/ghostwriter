import type { AccountId, ProviderId } from "@ghostwriter/core";

export type ProviderKeySeedSpec = Readonly<{
  providerId: ProviderId;
  envName: string;
}>;

/** BYOK env vars for the founder demo account on ordinary backend boot. */
export const DEMO_PROVIDER_KEY_SEED_SPECS: readonly ProviderKeySeedSpec[] = [
  { providerId: "openai", envName: "GHOSTWRITER_DEMO_SEED_OPENAI_KEY" },
  { providerId: "anthropic", envName: "GHOSTWRITER_DEMO_SEED_ANTHROPIC_KEY" },
  { providerId: "google", envName: "GHOSTWRITER_DEMO_SEED_GOOGLE_KEY" }
];

/** BYOK env vars for the hermetic E2E writer account. */
export const E2E_PROVIDER_KEY_SEED_SPECS: readonly ProviderKeySeedSpec[] = [
  { providerId: "openai", envName: "GHOSTWRITER_E2E_SEED_OPENAI_KEY" },
  { providerId: "anthropic", envName: "GHOSTWRITER_E2E_SEED_ANTHROPIC_KEY" },
  { providerId: "google", envName: "GHOSTWRITER_E2E_SEED_GOOGLE_KEY" }
];

export type SetProviderCredentialFn = (input: Readonly<{
  accountId: AccountId;
  providerId: ProviderId;
  plaintext: string;
}>) => Promise<unknown>;

export type SeedProviderKeysFromEnvInput = Readonly<{
  accountId: AccountId;
  specs: readonly ProviderKeySeedSpec[];
  setCredential: SetProviderCredentialFn;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  logPrefix?: string;
  /** When false, skip all seeding (e.g. KEK unavailable or calls disabled). */
  seedingEnabled?: boolean;
  seedingDisabledReason?: string;
}>;

/**
 * Upserts provider credentials from non-empty env vars. Logs provider ids only — never key
 * material. Errors are logged and swallowed so boot continues.
 */
export async function seedProviderKeysFromEnv(
  input: SeedProviderKeysFromEnvInput
): Promise<readonly ProviderId[]> {
  const log = input.log ?? console.log;
  const env = input.env ?? process.env;
  const logPrefix = input.logPrefix ?? "Demo provider seed";

  if (input.seedingEnabled === false) {
    if (input.seedingDisabledReason !== undefined) {
      log(input.seedingDisabledReason);
    }
    return [];
  }

  const seeded: ProviderId[] = [];
  for (const spec of input.specs) {
    const plaintext = env[spec.envName]?.trim();
    if (plaintext === undefined || plaintext.length === 0) {
      continue;
    }
    try {
      await input.setCredential({
        accountId: input.accountId,
        providerId: spec.providerId,
        plaintext
      });
      seeded.push(spec.providerId);
      log(`${logPrefix}: ${spec.providerId} key loaded (from env).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`${logPrefix}: failed to store ${spec.providerId} key (${message}).`);
    }
  }
  return seeded;
}
