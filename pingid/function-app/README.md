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
node --env-file=.env dist/server.js
```

Keep `DBX_SP_CLIENT_SECRET` and `STATE_ENCRYPTION_SECRET` in a secret manager or encrypted application settings. Never put either value in the X-Page package.

## Host on Azure Functions

All backend source, Azure Functions files, settings templates and packaging scripts are in this `function-app/` folder. Follow [Deploy into an existing Function App](DEPLOYMENT.md) for the steps, including shared-app integration and Kong configuration.

```bash
npm ci
npm test
npm run package:functions
```

Output: `artifacts/broker-functions.zip`. This package is for Azure; the separate `../artifacts/vault-crm-genie-service-principal-xpage.zip` is for Veeva.

The function is named `veevaGenieBroker`. It uses Node.js 22, Functions runtime 4 and the Node v4 programming model. With the provided `host.json`, broker-only apps expose `/health` and `/api/...`. For an app that retains other functions, keep its existing host configuration and mount the broker with `BROKER_FUNCTION_ROUTE_PREFIX` as described in the deployment guide.

Function-level authorization defaults to `function`: Kong supplies `x-functions-key`. Keep the Databricks OAuth secret and ticket-signing secret in Key Vault references. `app-settings.example.json` is the portal settings checklist; `local.settings.example.json` is only for local development.

For local Functions testing, copy `local.settings.example.json` to `local.settings.json`, fill in its values, provide local storage/Azurite if using `UseDevelopmentStorage=true`, and run `npm run start:functions` with Azure Functions Core Tools v4. Local Functions testing does not enforce Function keys or replace Kong's Ping JWT validation.

The adapter streams responses, but Azure's HTTP request-duration limits still apply. Validate Research through the full customer path separately from Chat.

## Required Databricks permissions

The fixed service principal must be assigned to the workspace and have:

- Workspace access and Databricks SQL entitlement
- `CAN_RUN` on the Genie Agent
- `CAN_USE` on the Agent's SQL warehouse
- `USE CATALOG`, `USE SCHEMA`, and `SELECT` on the claim-scoped views exposed through the Agent, and no access to the underlying tables or entitlements

The claim-scoped view's `user_entitlements` table must be keyed on the lowercase `sub` values that appear in the Ping tokens; typically the rep's corporate user ID. The checked-in settings templates contain placeholders; supply the customer workspace, Genie space and service principal values.
