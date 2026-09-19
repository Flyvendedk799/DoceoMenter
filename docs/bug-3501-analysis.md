# Analysis of the #3501 SUBSCRIPTION_REQUIRED / `aicode-consumers` Errors

## The Symptoms

When running with `gemini-3.1-pro` via the provider formerly labeled “Gemini subscription” (`gemini-cli`), Google’s Cloud Code API rejected the call. Two related failures showed up:

1. **`#3501 SUBSCRIPTION_REQUIRED`** — “You do not have a valid license… contact your administrator.”
2. **`aicode-consumers` IAM 403** (production, 2026-09-19 run `c5ef939388d0`):

```
Caller does not have required permission to use project aicode-consumers.
Grant … roles/serviceusage.serviceUsageConsumer … project=aicode-consumers
```

The second failure happened on a **provider-panel Google connect**, with DoceoMenter saying the run was **not** using the machine `agy` login.

Local `agy` on the same personal Google AI account worked.

## Root Cause (verified)

1. Every browser visitor gets an account cookie. An earlier workaround refused to fall through to the host `agy` login whenever that cookie was present, so browser runs were forced onto provider-panel OAuth — unlike Claude Code, which uses machine login when the panel is empty.
2. Panel OAuth + `loadCodeAssist` often returned Google’s **enterprise shared consumer project** `aicode-consumers` as `cloudaicompanionProject`. DoceoMenter persisted it and sent it as `x-goog-user-project` / `project`.
3. **Personal Google AI / Antigravity subscriptions have no IAM on `aicode-consumers`.** Attaching that project produces the serviceUsageConsumer 403 (and related #3501-style refusals). Enterprise “contact your administrator” copy is the wrong happy path for this product.
4. Earlier DoceoMenter builds also sent Gemini-CLI Code Assist metadata (`pluginType: GEMINI`) and wrong Dogfood hosts, which triggered “Client does not support Google TOS” before a usable managed project could be discovered.

## Product intent

- Brand and UX: **Antigravity** (not “gemini-cli” / “Gemini subscription”).
- Primary auth: **machine Antigravity (`agy`) login**, as smooth as Claude Code’s machine login.
- Audience: **personal Google AI only** — never assume enterprise/team access to `aicode-consumers`.

## Fix applied

1. **Reject `aicode-consumers`** everywhere (`sanitizePersonalCloudCodeProject`): discovery, store, resolve, and transport never send it.
2. **Claude-shaped credential resolve**: if the panel has no Antigravity connect, fall through to the host `agy` login even when an account cookie exists. Status UI reports machine login the same way.
3. **Copy**: 403s tell personal users to reconnect Antigravity / `agy`, not to grant IAM on `aicode-consumers`.
4. **Provider panel**: labeled Antigravity; machine login primary; panel Connect secondary; no “admin gave you a project” framing.
5. **Match `agy` wire format**: `loadCodeAssist` with `{ metadata: { ideType: "ANTIGRAVITY" } }` only; `onboardUser` with snake_case metadata; short `User-Agent: antigravity/1.21.9 linux/amd64` on generateContent (no Gemini-CLI `Client-Metadata`); G1/Dogfood generateContent on `daily-cloudcode-pa.googleapis.com`; discovery tries daily → prod → sandbox without aborting when `ineligibleTiers` sits next to an allowed/paid tier.

Internal provider id stays `gemini-cli` for the `ai-auth` registry; user-facing strings say Antigravity.
