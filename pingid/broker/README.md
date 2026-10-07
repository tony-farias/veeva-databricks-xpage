# Shared service-principal broker (Ping Federate / Kong variant)

This broker sits behind a Kong gateway. Every request carries the end user's Ping Federate bearer token, which Kong validates and forwards. The broker reads the user's identity from the token's `sub` claim and calls the configured Databricks Genie Agent with one fixed workspace service principal. Each Databricks token carries that identity claim, so claim-scoped views return only that user's rows.

It is a variant of the `service-principal/` broker. The differences are the identity source and statelessness: instead of verifying a Veeva Vault session once and issuing its own session token, it trusts Kong to have authenticated the Ping token on every call and derives the identity from that token on every call.

## Trust model

Kong authenticates the Ping Federate bearer token — signature, issuer, audience, and expiry — on every request and forwards it on the `Authorization` header. **The broker trusts that validation and does not re-verify the signature.** It decodes the payload, rejects a token whose `exp` is already in the past (defense in depth), and reads the configured identity claim (`IDENTITY_CLAIM_NAME`, default `sub`). Deploy the broker so that only Kong can reach it.

## Identity model

```text
Ping Federate        -> bearer token whose `sub` claim identifies the user
Kong gateway         -> validates the token on every call, forwards Authorization
Identity claim       -> lowercase value of the IDENTITY_CLAIM_NAME claim (sub), per request
Databricks OAuth M2M -> service-principal token minted with `custom_claim`, cached per claim
Genie API request    -> service-principal grants + claim-scoped rows
Conversation ticket  -> conversation bound to the claim that started it
Structured app log   -> end user (sub) + service principal + IDs
```

The broker rejects any request whose bearer token is missing, unreadable, expired, or lacks the identity claim. There is no broker session: `POST /api/session` only confirms the identity and data scope for the X-Page's connection screen. The broker caches Databricks tokens per identity claim and uses a token only after confirming that Databricks echoed the exact claim back for this service principal.

Every user shares one service principal, so Genie itself would let any user read any conversation, including stored results computed under another user's claim. The broker therefore returns a signed `conversation_ticket` when a conversation starts (for Agent mode, as a `broker.conversation` stream event) and requires it in `X-Conversation-Ticket` on every follow-up call. A ticket only verifies for the same Genie Agent and identity claim.

Databricks audit events and query history identify the service principal; they never contain the identity claim. Structured `genie.audit` log entries provide the compensating attribution, including `chat.statements` entries that map Genie statement IDs to the end user's `sub`, without logging prompts or query results.

## Kong route

- Route all `/api/*` paths to the broker and validate the Ping JWT on every one of them (for example with Kong's JWT or OpenID Connect plugin).
- Pass `Authorization` and `X-Conversation-Ticket` through to the broker unchanged.
- The MyInsights X-Page calls Kong through the native `ds.request` bridge, so no CORS configuration is needed for it. CORS (`ALLOWED_PARENT_ORIGINS`) only matters for browser `fetch` callers during local testing.
- Agent mode returns `text/event-stream`. Over `ds.request` the X-Page waits for the whole response (up to 300 s), so the route's upstream read timeout must allow that.
- Visualizations are requested with `?encoding=base64` and returned as JSON, because `ds.request` returns bodies as text.

## Run

```bash
cp .env.example .env
npm ci
npm test
npm start
```

Keep `DBX_SP_CLIENT_SECRET` and `STATE_ENCRYPTION_SECRET` in a secret manager or encrypted application settings. Never put either value in the X-Page package.

## Host on Azure Functions

The broker also runs on an Azure Function App. `src/functions/broker.ts` registers one catch-all HTTP trigger (Node.js v4 programming model) that forwards every request to the same Express app, listening on a loopback port inside the worker. Routes, status codes, headers, and bodies are unchanged, and responses are streamed, so Agent mode is not buffered by the Function host. `src/server.ts` remains the entry point for App Service or containers (`Dockerfile`).

**Function App:** Linux, Node.js 20 or 22, Functions runtime 4, `FUNCTIONS_WORKER_RUNTIME=node`. Flex Consumption with an always-ready instance, or Premium, avoids cold starts; on Consumption the 10-minute `functionTimeout` in `host.json` is the plan maximum. Deploy the broker as its own Function App behind the same Kong gateway: `host.json` clears the `api` route prefix so URLs match the standalone server (`/api/...`, `/health`), and the catch-all trigger takes every path in the app.

**App settings:** the same values as `.env.example`, plus `BROKER_FUNCTION_AUTH_LEVEL`:

- `function` (default): the trigger requires a function key. Configure Kong to add it to every upstream request as the `x-functions-key` header (for example with the Request Transformer plugin). The broker never sees the key.
- `anonymous`: only when access restrictions or a private endpoint already limit callers to Kong.

Store `DBX_SP_CLIENT_SECRET` and `STATE_ENCRYPTION_SECRET` in Key Vault and reference them from app settings (`@Microsoft.KeyVault(SecretUri=...)`) through the Function App's managed identity.

**Build and deploy:**

```bash
npm ci
npm run package:functions        # artifacts/broker-functions.zip: compiled broker, host.json, production dependencies
az functionapp deployment source config-zip -g <resource-group> -n <function-app> --src artifacts/broker-functions.zip
```

**Run locally:** copy `local.settings.example.json` to `local.settings.json` (git-ignored), fill in the values, and run `npm run start:functions` (requires Azure Functions Core Tools 4). Function keys are not enforced locally.

Azure's front end ends an HTTP request that is idle for 230 seconds. Agent mode streams events as Genie works, and the X-Page waits up to 300 s for a full Agent response over `ds.request`, so keep Kong's upstream read timeout at 300 s or more.

## Required Databricks permissions

The fixed service principal must be assigned to the workspace and have:

- Workspace access and Databricks SQL entitlement
- `CAN_RUN` on the Genie Agent
- `CAN_USE` on the Agent's SQL warehouse
- `USE CATALOG`, `USE SCHEMA`, and `SELECT` on the claim-scoped views exposed through the Agent, and no access to the underlying tables or entitlements

The claim-scoped view's `user_entitlements` table must be keyed on the lowercase `sub` values that appear in the Ping tokens; typically the rep's corporate user ID. The checked-in `.env.example` identifies the configured service principal and Agent but contains no secret.
