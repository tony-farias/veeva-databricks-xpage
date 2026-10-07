# Veeva X-Page with a fixed Databricks service principal — Ping Federate / Kong variant

This directory is a variant of `../service-principal`. It keeps the same shared-service-principal design and identity-claim row scoping, but takes the end user's identity from a **Ping Federate bearer token that travels through a Kong gateway on every request** instead of a Veeva Vault session. The per-user row filter is keyed on the token's `sub` claim.

Use this variant when the customer already authenticates reps through Ping Federate inside MyInsights / X-Pages and already calls its APIs through Kong (iRep → Ping → Kong → backend → Databricks).

## Identity flow

```text
iRep iPad client (MyInsights / X-Page)
        |
        | ds.getSSOAccessToken(authIdentifier, providerName, oldToken)
        |   -> Ping Federate bearer token; `sub` carries the rep's user ID
        | ds.request({ url: <Kong route>, headers: { Authorization: Bearer <Ping token> } })
        v
Kong gateway
        |  validates the bearer token on every call (signature, issuer, audience, expiry)
        |  forwards the Authorization and X-Conversation-Ticket headers to the broker
        v
Service-principal broker (this variant, stateless)
        |  1. reads the `sub` claim from the forwarded token on every call (trusts Kong)
        |  2. obtains a Databricks OAuth M2M token carrying `sub` as the claim (cached per claim)
        |  3. binds each Genie conversation to the claim with a signed ticket
        |  4. correlates the end user (`sub`) in structured audit logs
        v
Fixed Databricks service principal + identity claim
        |
        +--> Genie Agent chat and Agent mode APIs
        +--> query-result and visualization APIs
        +--> claim-scoped views: rows filtered by current_oauth_custom_identity_claim()
```

**Trust boundary:** Kong validates the Ping token on every call; the broker does not re-verify the signature. The broker decodes the payload, rejects a token whose `exp` has passed, and reads the configured claim (`IDENTITY_CLAIM_NAME`, default `sub`). Deploy the broker so only Kong can reach it. The service-principal secret and Databricks access token never enter the client. The broker mints one Databricks token per identity claim, caches it per claim, and uses it only after confirming the returned JWT carries the exact claim for the service principal; otherwise it fails closed.

## Request flow and conversation binding

There is no broker session token. Every call — connect, chat, results, visualizations, and Agent mode — carries `Authorization: Bearer <Ping token>`, Kong validates it, and the broker derives the identity from it again. `POST /api/session` only returns the user and data scope for the connection screen.

Because every user shares one service principal, Genie treats them as the same caller and would otherwise let any user open any conversation — including stored results computed under another user's identity claim. The broker binds each conversation to the claim that started it:

- When a conversation starts, the broker returns a `conversation_ticket`: an HMAC over the Genie Agent, conversation ID, and identity claim. Agent mode delivers the ticket as a `broker.conversation` stream event.
- Every later call — follow-up messages, query results, visualizations, and Agent-mode items — must present that ticket in the `X-Conversation-Ticket` header. A ticket verifies only for the same Agent, conversation, and claim; a ticket presented with another user's token is rejected with HTTP 403.
- Tickets are self-contained (signed), so the broker holds no per-conversation or per-user server state and can run as more than one instance.

## Calling Kong from the X-Page

The X-Page calls Kong the same way MyInsights dashboards already do:

- **Token.** `src/lib/pingToken.ts` calls `ds.getSSOAccessToken(authIdentifier, providerName, oldToken)`, which resolves `{ success, data: { token } }`. The token is cached and its `exp` decoded. When less than 60 s remain, the client first calls with `oldToken = null` to get the current token, then calls again passing that token as `oldToken` to force a refresh. If Kong answers HTTP 401, the client forces a refresh once and retries the call.
- **Transport.** `src/lib/headlessGenie.ts` sends every call through `ds.request({ url, method, headers, body, expect: "text", timeout })`, which runs natively (no browser CORS) and resolves `{ success, data: { statusCode, body } }`. Outside MyInsights it falls back to `fetch`.
- **Agent mode.** `ds.request` cannot stream, so the X-Page waits for the full Agent-mode response (timeout 300 s) and then replays its events, including the `broker.conversation` ticket. With `fetch` it streams progressively.
- **Visualizations.** Requested with `?encoding=base64` and decoded on the client, because `ds.request` returns text.

`ssoAuthIdentifier` and `ssoProviderName` in `public/xpage-config.js` are the two arguments to `getSSOAccessToken`. In an existing MyInsights setup they are the two halves of the Veeva Message `AUTH_PROVIDER`, whose value has the form `authIdentifier;;;providerName`. For local testing or non-MyInsights hosts, set `window.__PING_ACCESS_TOKEN__` to a token; it is used as-is.

## Kong route requirements

- Route all `/api/*` paths to the broker and validate the Ping JWT on every one of them.
- Pass `Authorization` and `X-Conversation-Ticket` through unchanged.
- No CORS policy is needed for `ds.request` callers.
- Allow at least 300 s upstream read time for `POST /api/genie/agent/responses` (Agent mode).
- When the broker runs on Azure Functions with the default function-level auth, add the function key to every upstream request as the `x-functions-key` header.

## Configured demo resources

| Resource | Value |
| --- | --- |
| Workspace | `adb-7405608383447105.5.azuredatabricks.net` |
| Genie Agent | `01f1c1bc36b518d7b7a59b21c1bd3b92` (claim-scoped) |
| SQL warehouse | `befedd56fadee1fa` |
| Service principal | `veeva-xpage-genie-shared` (`6d18456b-9dba-4ca9-9e65-d2843df4dd7a`) |
| Claim-scoped view | `af_vault_genie_demo.nsclc_rwe_scoped.gold_patient_master_scoped` |
| Identity claim name | `sub` (`IDENTITY_CLAIM_NAME`) |

This variant's broker is **not deployed**; `public/xpage-config.js` ships with `REPLACE-ME` values for the Kong route and the SSO provider. The entitlement table must be keyed on the lowercase `sub` values that appear in the Ping tokens. `sub` is the rep's corporate user ID, so an existing user-to-territory alignment keyed on that ID can populate it directly (lowercased).

## Repointing to another workspace, Genie Agent, or claim name

Nothing is hard-coded in source. There are two config files because there are two deployables, and the split is deliberate: **the browser file must never contain a secret.** The broker runs on App Service or a container (`broker/Dockerfile`) or on an Azure Function App (`broker/host.json`, see [Host on Azure Functions](broker/README.md#host-on-azure-functions)).

| What to change | Browser — `public/xpage-config.js` | Broker — `.env` locally, or App Service / Function App settings |
| --- | --- | --- |
| Workspace | `workspaceHost`, `workspaceOrgId` | `DBX_WORKSPACE_HOST` |
| Genie Agent | `genieAgentId` | `DBX_GENIE_AGENT_ID` |
| Kong route to the broker | `authBrokerBaseUrl` | — |
| SSO provider for `getSSOAccessToken` | `ssoAuthIdentifier`, `ssoProviderName` | — |
| Identity claim name | — | `IDENTITY_CLAIM_NAME` (default `sub`) |
| Browser-caller origin allowlist (local `fetch` only) | — | `ALLOWED_PARENT_ORIGINS` |
| Function key required (Azure Functions only) | — | `BROKER_FUNCTION_AUTH_LEVEL` (default `function`) |
| Header and context labels (cosmetic) | `displayName`, `contextLabel` | — |

`workspaceHost` / `DBX_WORKSPACE_HOST` and `genieAgentId` / `DBX_GENIE_AGENT_ID` must match across the two files. Only the broker file holds secrets (`DBX_SP_CLIENT_SECRET`, and `STATE_ENCRYPTION_SECRET`, which signs conversation tickets); never place those in `public/xpage-config.js`.

## Row scoping with identity claims

The mechanism is identical to `../service-principal`: a Databricks OAuth token carries an opaque `custom_claim`, SQL reads it with `current_oauth_custom_identity_claim()`, and a claim-scoped Unity Catalog view filters rows by matching that claim against an entitlement table. Here the claim value is the Ping token's `sub`, lowercased. Build the data objects with `ops/create_identity_claim_rls.sql` and `ops/apply-claim-scoped-view.mjs`, keying `user_entitlements.claim_key` on the `sub` values.

A caller with no claim fails with `OAUTH_CUSTOM_IDENTITY_CLAIM_NOT_PROVIDED`; a claim with no entitlement rows sees zero rows. The service principal can read only the claim-scoped view, not the base table or the entitlement table.

## Authorization behavior

Databricks sees the fixed service principal as the caller. Therefore:

- All users share its catalog, schema, warehouse, and Genie Agent grants.
- Claim-scoped views limit rows to the entitlements of each user's `sub`. Unity Catalog row filters, column masks, and group checks keyed on `current_user()` still evaluate the service principal.
- Databricks query history and audit logs identify the service principal and do not record the claim.
- Structured broker logs correlate the end user (`sub`), service principal, Genie Agent, conversation, message, attachment, and statement identifiers.
- Prompts and result contents are intentionally excluded from broker audit logs.

## Choosing between the implementations

| Question | Per-user federation (repo root) | Vault service principal (`../service-principal`) | Ping service principal (this directory) |
| --- | --- | --- | --- |
| Identity source | Veeva/Entra federated user | Veeva Vault session | Ping Federate bearer token via Kong |
| Databricks caller | Individual user | Fixed service principal | Fixed service principal |
| Databricks user provisioning | Required | Not required | Not required |
| Per-user row scoping | Native row filters | Claim-scoped views (Federated ID) | Claim-scoped views (Ping `sub`) |
| Who authenticates the user | Databricks (token exchange) | The broker (Vault API) | Kong (Ping token, every call), trusted by the broker |
| Broker session | — | Sealed broker session token | None; Ping token on every call |

Choose this variant when reps are authenticated through Ping Federate and a gateway (Kong) already fronts the API.

## Security boundary

The broker trusts Kong to authenticate the Ping bearer token. It must therefore be reachable only through Kong — not directly from the public internet — because it does not re-verify the token signature, issuer, or audience. The identity claim is derived only from the forwarded token, never from other browser input. The service-principal secret controls both Databricks access and, through the claim, row access; keep it in a secret manager and rotate it.

If you prefer the broker to verify the Ping token itself (issuer, audience, signature via Ping's JWKS) rather than trust Kong, that is a localized change in `broker/src/pingIdentity.ts` — add JWKS-based verification before reading the claim.

## References

- [Databricks: OAuth machine-to-machine authentication](https://learn.microsoft.com/en-us/azure/databricks/dev-tools/auth/oauth-m2m)
- [Databricks: current_oauth_custom_identity_claim](https://docs.databricks.com/aws/en/sql/language-manual/functions/current_oauth_custom_identity_claim)
- [Kong Gateway: forwarding upstream headers](https://docs.konghq.com/gateway/latest/)
