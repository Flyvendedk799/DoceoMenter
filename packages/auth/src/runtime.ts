/**
 * The two credential stores, built once per process.
 *
 * `ai-auth` deliberately owns no storage and no secret: it takes a `CredentialStore` and a
 * host secret and does the sealing itself. This file makes the two choices DoceoMenter has to
 * make — where the rows live, and where the secret comes from — and makes them the same way
 * in the web app and in the worker, which is the point. Both processes read the same file (or
 * the same table) with the same key, so a subscription connected in the browser is usable by
 * the worker without the token ever passing through the job queue.
 *
 * When nothing can be stored the runtime says so instead of throwing. The UI then shows a
 * feature it cannot offer as unavailable rather than as broken — the same posture the
 * library's own routes take with `available: false`.
 */

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";
import {
  ApiKeyStore,
  ClaudeAccountStore,
  JsonFileCredentialStore,
  MemoryCredentialStore,
  type CredentialStore,
} from "@flyvendedk799/ai-auth";
import {
  credentialFilePath,
  loadAuthConfig,
  secretFilePath,
  type AuthConfig,
} from "./config.js";
import { signAccountId, verifyAccountToken } from "./session.js";

export type SecretSource = "environment" | "file" | "ephemeral";
export type StoreKind = "postgres" | "file" | "memory";

export type AuthRuntime = {
  /** False when credentials cannot be persisted, which the UI reports rather than hides. */
  available: boolean;
  /** Present when `available` is false: what to do about it. */
  reason?: string;
  accounts: ClaudeAccountStore;
  /**
   * API keys, scoped to one browser.
   *
   * Namespaced per account rather than shared, because this app is a page anyone can open: a
   * single deployment-wide row would mean the next visitor's runs are paid for by whichever
   * key the last visitor happened to paste. Pass null for the deployment's own store, which is
   * what the environment fallback resolves through either way.
   */
  keysFor(accountId: string | null): ApiKeyStore;
  /**
   * Signing for the account cookie, derived from the same host secret.
   *
   * Exposed as two functions rather than as the secret, so the only thing any caller can do
   * with it is mint and check an account id.
   */
  session: { sign(accountId: string): string; verify(token: string | undefined | null): string | null };
  secretSource: SecretSource;
  storeKind: StoreKind;
  config: AuthConfig;
};

type PoolConstructor = new (options: { connectionString: string }) => {
  query<R = unknown>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
};

let cached: Promise<AuthRuntime> | undefined;

/** The process-wide runtime. Built once; the stores hold in-flight refresh state worth sharing. */
export function getAuthRuntime(env: NodeJS.ProcessEnv = process.env): Promise<AuthRuntime> {
  if (!cached) cached = buildAuthRuntime(loadAuthConfig(env), env);
  return cached;
}

/** Test seam. Drops the memoised runtime so the next call rebuilds from the environment. */
export function resetAuthRuntime(): void {
  cached = undefined;
}

export async function buildAuthRuntime(
  config: AuthConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AuthRuntime> {
  const store = await openStore(config);
  const secret = await resolveSecret(config, store.kind);

  const accounts = new ClaudeAccountStore({
    store: store.store,
    secret: secret.value,
    ...(config.namespace ? { namespace: config.namespace } : {}),
  });
  const keyStores = new Map<string, ApiKeyStore>();
  const keysFor = (accountId: string | null): ApiKeyStore => {
    const namespace = [config.namespace, accountId ? `acct:${accountId}` : null]
      .filter(Boolean)
      .join(":");
    const cached = keyStores.get(namespace);
    if (cached) return cached;
    const built = new ApiKeyStore({
      store: store.store,
      secret: secret.value,
      ...(namespace ? { namespace } : {}),
      env,
    });
    keyStores.set(namespace, built);
    return built;
  };

  const available = store.kind !== "memory";
  return {
    available,
    ...(available
      ? {}
      : {
          reason:
            store.reason ??
            "Credentials cannot be stored: no writable credentials directory and no CREDENTIALS_DATABASE_URL.",
        }),
    accounts,
    keysFor,
    session: {
      sign: (accountId) => signAccountId(accountId, secret.value),
      verify: (token) => verifyAccountToken(token, secret.value),
    },
    secretSource: secret.source,
    storeKind: store.kind,
    config,
  };
}

async function openStore(
  config: AuthConfig,
): Promise<{ store: CredentialStore; kind: StoreKind; reason?: string }> {
  if (config.databaseUrl) {
    try {
      const { PostgresCredentialStore } = await import("@flyvendedk799/ai-auth/postgres");
      // `pg` is not a dependency of this app either — the adapter only wants a `query`
      // method, so whatever pool the deployment already has satisfies it. The specifier goes
      // through a variable so a build without Postgres installed neither resolves nor bundles
      // a driver it will never load.
      const driver = "pg";
      // `webpackIgnore` leaves this as a real runtime import instead of something a bundler
      // tries to follow — which it cannot, the specifier being a variable, and would otherwise
      // warn about on every build of an app that has no Postgres at all.
      const pg = (await import(/* webpackIgnore: true */ driver)) as {
        Pool?: PoolConstructor;
        default?: { Pool?: PoolConstructor };
      };
      const Pool = pg.Pool ?? pg.default?.Pool;
      if (!Pool) throw new Error("the installed `pg` exposes no Pool");
      const db = new Pool({ connectionString: config.databaseUrl });
      return {
        store: new PostgresCredentialStore({ db, table: config.databaseTable }),
        kind: "postgres",
      };
    } catch (error) {
      return {
        store: new MemoryCredentialStore(),
        kind: "memory",
        reason: `CREDENTIALS_DATABASE_URL is set but the Postgres store could not be opened (${
          (error as Error).message
        }). Install \`pg\` and run the ai-auth SCHEMA_SQL migration, or unset the variable to fall back to a file.`,
      };
    }
  }

  const path = credentialFilePath(config);
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    return { store: new JsonFileCredentialStore({ path }), kind: "file" };
  } catch (error) {
    return {
      store: new MemoryCredentialStore(),
      kind: "memory",
      reason: `The credentials directory ${dirname(path)} is not writable (${
        (error as Error).message
      }). Set CREDENTIALS_DIR to a writable path.`,
    };
  }
}

/**
 * The host secret.
 *
 * An explicit `DOCEOMENTER_SECRET_KEY` wins and is the only option that works when the web app
 * and the worker are separate containers — they must derive the same key or each will read the
 * other's rows as unreadable, which surfaces as users being mysteriously signed out.
 *
 * Failing that, one is generated beside the credential file. That is a real trade rather than
 * a shortcut: it keeps a single-host install working across restarts with nothing to
 * configure, and it is useless the moment there is a second host.
 */
async function resolveSecret(
  config: AuthConfig,
  storeKind: StoreKind,
): Promise<{ value: string; source: SecretSource }> {
  if (config.secret) return { value: config.secret, source: "environment" };
  if (storeKind === "memory") return { value: randomBytes(32).toString("hex"), source: "ephemeral" };

  const path = secretFilePath(config);
  try {
    const existing = (await readFile(path, "utf8")).trim();
    if (existing.length >= 32) return { value: existing, source: "file" };
  } catch {
    // Missing or unreadable: generate one below.
  }

  try {
    const generated = randomBytes(32).toString("hex");
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, `${generated}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(path, 0o600);
    return { value: generated, source: "file" };
  } catch {
    // A read-only filesystem. Everything still works for this process; nothing survives it.
    return { value: randomBytes(32).toString("hex"), source: "ephemeral" };
  }
}
