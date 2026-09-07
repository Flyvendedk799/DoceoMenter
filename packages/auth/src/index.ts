/**
 * DoceoMenter's credential layer: `ai-auth`, wired to this app's storage and its idea of a user.
 *
 * Node only — it reads the filesystem and `node:crypto`. Anything that runs in a browser wants
 * `@flyvendedk799/ai-auth/registry`, which carries the model catalogue and the pricing table
 * with none of the credential handling.
 */

export { loadAuthConfig, credentialFilePath, secretFilePath, type AuthConfig } from "./config.js";
export {
  buildAuthRuntime,
  getAuthRuntime,
  resetAuthRuntime,
  type AuthRuntime,
  type SecretSource,
  type StoreKind,
} from "./runtime.js";
export {
  ACCOUNT_COOKIE,
  ACCOUNT_COOKIE_MAX_AGE,
  newAccountId,
  readCookie,
  serializeAccountCookie,
  signAccountId,
  verifyAccountToken,
} from "./session.js";
export {
  PROVIDERS,
  describeProvider,
  providerLabel,
  type ProviderDescriptor,
} from "./providers.js";
export {
  CredentialError,
  readLocalClaudeStatus,
  readLocalCodex,
  resolveProviderCredential,
  type CredentialSource,
  type ProviderCredential,
  type ResolveOptions,
} from "./credentials.js";
export { readAuthStatus, type AuthStatus, type ProviderStatus } from "./status.js";
export {
  completeLogin,
  forgetPendingLogin,
  pendingLogins,
  startLogin,
  type LoginFailure,
  type PendingLogins,
} from "./login.js";

// Re-exported so the rest of the app has one import for the provider vocabulary rather than
// two, and so a swap of the underlying library is one file's problem.
export {
  describeProviderError,
  isSubscription,
  modelsFor,
  modelSpec,
  pricingFor,
  providerErrorFacts,
  wireOf,
  type ModelSpec,
  type ProviderErrorFacts,
  type ProviderId,
} from "@flyvendedk799/ai-auth/registry";
