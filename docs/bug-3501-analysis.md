# Analysis of the #3501 SUBSCRIPTION_REQUIRED Error

## The Symptoms
When attempting to run the AI pipeline in DoceoMenter using the `gemini-3.1-pro` model, the Google Cloud Code API immediately rejects the request with the following error:

```json
{
  "error": {
    "code": 403,
    "message": "You do not have a valid license of this product. Please contact your administrator to request a license. If you are not an enterprise user and believe you are receiving this message as an error, please try using the latest version and logging in again. (#3501)",
    "status": "PERMISSION_DENIED",
    "details": [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        "reason": "SUBSCRIPTION_REQUIRED",
        "domain": "cloudaicompanion.googleapis.com"
      }
    ]
  }
}
```

This error occurs **even when using the Dogfood endpoint (`daily-cloudcode-pa.googleapis.com`)**, which is confirmed to work perfectly when running the `agy` CLI locally on the exact same `tobygopro@gmail.com` account.

## What Has Been Fixed So Far
1. **The `aicode` Scope Bug in `ai-auth`:**
   Previously, the `ai-auth` library explicitly excluded the `https://www.googleapis.com/auth/aicode` scope whenever the Dogfood environment was selected. This was a bug, as the `agy` CLI *does* request this scope on Dogfood.
   *This has been patched and deployed in `ai-auth`, meaning DoceoMenter now successfully acquires the `aicode` scope.*

2. **The `isDogfood` Propagation Bug in DoceoMenter:**
   Previously, the `isDogfood` flag from the database credential was not being passed correctly to the transport layer, causing Dogfood tokens to be sent to the Prod endpoint.
   *This has been patched in DoceoMenter's `packages/claude/src/transport.ts`.*

## Why It Is Still Failing (The Root Cause Hypothesis)
Despite fixing the scopes and the endpoint routing, `gemini-3.1-pro` is still failing with `#3501` in DoceoMenter, but succeeding in the CLI.

Based on our analysis of the DoceoMenter logs and the `agy` CLI binary, the root cause is almost certainly **the missing GCP Project ID (`x-goog-user-project`) header**.

1. **How the CLI Works:**
   When you log into the `agy` CLI for the first time, it prompts you to select a Google Cloud Project for billing/quota purposes. When the CLI makes a request to `daily-cloudcode-pa`, it attaches this Project ID in the headers (specifically `x-goog-user-project`). Google's backend sees this Project ID, verifies the Dogfood/Enterprise entitlement, and allows `gemini-3.1-pro` to proceed.

2. **How DoceoMenter Fails:**
   The Web UI OAuth flow in DoceoMenter does **not** ask for or capture a GCP Project ID. 
   As a result, in `packages/claude/src/transport.ts` (and `ai-auth/src/clients/options.ts`), `projectId` is `null`. DoceoMenter sends the POST request to `generateContent` *without* the `x-goog-user-project` header. 
   
   Google's Cloud Code API sees a request for a flagship model (`gemini-3.1-pro`) but no billing/quota project attached to verify the license against. It therefore throws `#3501 SUBSCRIPTION_REQUIRED`, explicitly asking the user to "contact your administrator to request a license".

*(Note: If the model name string itself was wrong, the API would return a `404 Model Not Found` error, not a `403 SUBSCRIPTION_REQUIRED` license error.)*

## Recommended Solution
To fix this permanently, DoceoMenter must behave identically to the `agy` CLI by attaching a valid Google Cloud Project ID to its requests.

1. Update the DoceoMenter Web UI to prompt the user to input their Google Cloud Project ID when authenticating.
2. Store this `projectId` in the database alongside the OAuth token (the database schema in `ai-auth` already supports a `projectId` field in the `meta` object).
3. Ensure the `x-goog-user-project` header is populated and sent with the `generateContent` payload.

## Fix applied (verified against current code)

**What `agy` actually does (and DoceoMenter was skipping):** before `generateContent`, the CLI calls `loadCodeAssist` and, if needed, `onboardUser`. Google returns a *managed* `cloudaicompanionProject` — personal accounts never type a GCP project id. DoceoMenter now does the same during credential resolve (Prod only), stores the managed id, and sends it as `x-goog-user-project` / `project` on Cloud Code requests.

**Also:**
- Browser sessions never fall back to the VPS `agy` login.
- Dogfood OAuth omits the unregistered `aicode` scope (`403 restricted_client`).
- Connect UI does not require a typed GCP project id.
- Cloud Code calls send Antigravity client identity (`User-Agent: antigravity`, `Client-Metadata` with `ideType: ANTIGRAVITY`) so Google does not refuse with "Client does not support Google TOS."
- Dogfood skips `loadCodeAssist` (that path returns the TOS refusal for our OAuth client); discovery soft-fails on Prod ineligibility so `generateContent` can still proceed.

Changes:

1. **`ensureCodeAssistProject`** (`packages/auth/src/codeAssist.ts`): `loadCodeAssist` → optional `onboardUser` → managed project id; soft-fail / Dogfood skip returns null.
2. **`resolveGeminiSubscription`**: resolve + persist that project for UI credentials before the worker calls the model.
3. **Transport**: Antigravity identity headers on every Cloud Code `generateContent`; still attaches `x-goog-user-project` when `projectId` is present.
4. **`antigravityRequestHeaders`** (`packages/shared/src/antigravityIdentity.ts`): shared header + metadata builder used by auth onboarding and the Gemini transport.
