/**
 * Where the credential layer keeps things, and what it is allowed to read.
 *
 * Every value here has a working default, because the first-run experience of a self-hosted
 * tool should not be a wall of required environment variables. The one that matters is the
 * host secret: it is the key half of the encryption for every stored credential, and losing
 * it signs everyone out. Set `DOCEOMENTER_SECRET_KEY` in anything with more than one process.
 */

import { join } from "node:path";

export type AuthConfig = {
  /** The host secret, when the environment supplies one. */
  secret?: string;
  /** Directory holding the credential file and the generated secret, when no store is configured. */
  dataDir: string;
  /** Postgres connection string. When set, credentials live in a table instead of a file. */
  databaseUrl?: string;
  /** Table name for the Postgres store. */
  databaseTable: string;
  /**
   * Whether a `claude` / `codex` login already on this machine may be used.
   *
   * On by default for a single-operator install, which is the shape this app usually takes:
   * the person running it is the person whose plan pays. A multi-tenant deployment must turn
   * it off, or one visitor's run bills the operator's own subscription.
   */
  allowLocalCli: boolean;
  /** Prefixes every store key, so one database can hold more than one app. */
  namespace?: string;
};

const TRUE = new Set(["1", "true", "yes", "on"]);

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const secret =
    env.DOCEOMENTER_SECRET_KEY?.trim() || env.SECRET_KEY?.trim() || env.AUTH_SECRET?.trim();
  const dataRoot = env.DATA_ROOT?.trim() || "data/runs";
  const dataDir = env.CREDENTIALS_DIR?.trim() || join(dataRoot, "..", "credentials");
  const allowLocalCli = env.ALLOW_LOCAL_CLI === undefined ? true : TRUE.has(env.ALLOW_LOCAL_CLI.trim().toLowerCase());

  return {
    ...(secret ? { secret } : {}),
    dataDir,
    ...(env.CREDENTIALS_DATABASE_URL?.trim()
      ? { databaseUrl: env.CREDENTIALS_DATABASE_URL.trim() }
      : {}),
    databaseTable: env.CREDENTIALS_TABLE?.trim() || "ai_auth_credentials",
    allowLocalCli,
    ...(env.CREDENTIALS_NAMESPACE?.trim() ? { namespace: env.CREDENTIALS_NAMESPACE.trim() } : {}),
  };
}

export function credentialFilePath(config: AuthConfig): string {
  return join(config.dataDir, "credentials.json");
}

export function secretFilePath(config: AuthConfig): string {
  return join(config.dataDir, "secret.key");
}
