# Veeva X-Page with a fixed Databricks service principal — Ping Federate / Kong variant

This directory is a variant of `../service-principal`. It keeps the same shared-service-principal design and identity-claim row scoping, but takes the end user's identity from a **Ping Federate bearer token forwarded by a Kong gateway** instead of a Veeva Vault session. The per-user row filter is keyed on the token's `mudid` claim.

Use this variant when the customer already authenticates reps through Ping Federate (as in the GSK MyInsights flow: iRep → Salesforce/Ping → Kong → broker → Databricks) and identifies them by an MDM id (`mudid`).

## Identity flow

```text
iRep iPad client (MyInsights / X-Page)
        |
        | getSSOAccessToken() -> Ping Federate bearer token carrying mudid
        v
Kong gateway
        |  authenticates the bearer token (signature, issuer, audience, expiry)
        |  forwards the Authorization header to the broker
        v
Service-principal broker (this variant)
        |  1. reads the mudid claim from the forwarded token (trusts Kong)
        |  2. obtains a Databricks OAuth M2M token carrying mudid as the claim
        |  3. binds each Genie conversation to the claim with a signed ticket
        |  4. correlates the end user (mudid) in structured audit logs
        v
Fixed Databricks service principal + identity claim
        |
        +--> Genie Agent chat and Agent mode APIs
        +--> query-result and visualization APIs
        +--> claim-scoped views: rows filtered by current_oauth_custom_identity_claim()
```

**Trust boundary:** Kong validates the Ping token; the broker does not re-verify it. The broker only decodes the payload and reads the configured claim (`IDENTITY_CLAIM_NAME`, default `mudid`). Deploy the broker so only Kong can reach it. The service-principal secret and Databricks access token never enter the client. The broker mints one Databricks token per identity claim, caches it per claim, and uses it only after confirming the returned JWT carries the exact claim for the service principal; otherwise it fails closed.

## Request flow and conversation binding

After the first call, the broker returns its own short-lived encrypted session token (default 15 minutes), which the client sends on every later request. Because every user shares one service principal, Genie treats them as the same caller and would otherwise let any user open any conversation — including stored results computed under another user's identity claim.

The broker binds each conversation to the claim that started it:

- When a conversation starts, the broker returns a `conversation_ticket`: an HMAC over the Genie Agent, conversation ID, and identity claim. Agent mode delivers the ticket as a `broker.conversation` stream event.
- Every later call — follow-up messages, query results, visualizations, and Agent-mode items — must present that ticket in the `X-Conversation-Ticket` header. A ticket verifies only for the same Agent, conversation, and claim; a ticket from another user's session is rejected with HTTP 403.
- Tickets and the broker session are self-contained (signed/encrypted), so the broker holds no per-conversation server state and can run as more than one instance.

## Configured demo resources

| Resource | Value |
| --- | --- |
| Workspace | `adb-7405615520098858.18.azuredatabricks.net` |
| Genie Agent | `01f1bda165d9188a9d8121be0cc3a9b4` (claim-scoped) |
| SQL warehouse | `9515e3337e0471aa` |
| Service principal | `veeva-xpage-genie-shared` (`7cf9fe9b-c14f-4b9f-8fcf-a094f0421c7b`) |
| Claim-scoped view | `af_vault_genie_demo.nsclc_rwe_scoped.gold_patient_master_scoped` |
| Identity claim name | `mudid` (`IDENTITY_CLAIM_NAME`) |

This variant's broker is **not deployed**; `public/xpage-config.js` ships with a `REPLACE-ME` broker URL. The entitlement table must be keyed on the `mudid` values that appear in the Ping tokens, not on Vault usernames or Federated IDs.

## Repointing to another workspace, Genie Agent, or claim name

Nothing is hard-coded in source. There are two config files because there are two deployables, and the split is deliberate: **the browser file must never contain a secret.**

| What to change | Browser — `public/xpage-config.js` | Broker — `.env` locally, or App Service / Function App settings |
| --- | --- | --- |
| Workspace | `workspaceHost`, `workspaceOrgId` | `DBX_WORKSPACE_HOST` |
| Genie Agent | `genieAgentId` | `DBX_GENIE_AGENT_ID` |
| Broker URL | `authBrokerBaseUrl` | — |
| Identity claim name | — | `IDENTITY_CLAIM_NAME` (default `mudid`) |
| Caller origin allowlist | — | `ALLOWED_PARENT_ORIGINS` |
| Header and context labels (cosmetic) | `displayName`, `contextLabel` | — |

`workspaceHost` / `DBX_WORKSPACE_HOST` and `genieAgentId` / `DBX_GENIE_AGENT_ID` must match across the two files. Only the broker file holds secrets (`DBX_SP_CLIENT_SECRET`, `STATE_ENCRYPTION_SECRET`); never place those in `public/xpage-config.js`.

## Client token acquisition

The client obtains the Ping bearer token and sends it to the broker as `Authorization: Bearer <token>` on the first call. `src/lib/pingToken.ts` is the integration seam:

- In MyInsights, it calls the Veeva X-Pages bridge `getSSOAccessToken()` and extracts the token.
- For local testing or non-MyInsights hosts, set `window.__PING_ACCESS_TOKEN__` to a token.

Point `getAccessToken()` at whatever already returns the Ping-issued bearer token for the signed-in rep.

## Row scoping with identity claims

The mechanism is identical to `../service-principal`: a Databricks OAuth token carries an opaque `custom_claim`, SQL reads it with `current_oauth_custom_identity_claim()`, and a claim-scoped Unity Catalog view filters rows by matching that claim against an entitlement table. Here the claim value is the `mudid`. Build the data objects with `ops/create_identity_claim_rls.sql` and `ops/apply-claim-scoped-view.mjs`, keying `user_entitlements.claim_key` on the `mudid` values.

A caller with no claim fails with `OAUTH_CUSTOM_IDENTITY_CLAIM_NOT_PROVIDED`; a claim with no entitlement rows sees zero rows. The service principal can read only the claim-scoped view, not the base table or the entitlement table.

## Authorization behavior

Databricks sees the fixed service principal as the caller. Therefore:

- All users share its catalog, schema, warehouse, and Genie Agent grants.
- Claim-scoped views limit rows to the entitlements of each user's `mudid`. Unity Catalog row filters, column masks, and group checks keyed on `current_user()` still evaluate the service principal.
- Databricks query history and audit logs identify the service principal and do not record the claim.
- Structured broker logs correlate the end user (`mudid`), broker session, service principal, Genie Agent, conversation, message, attachment, and statement identifiers.
- Prompts and result contents are intentionally excluded from broker audit logs.

## Choosing between the implementations

| Question | Per-user federation (repo root) | Vault service principal (`../service-principal`) | Ping service principal (this directory) |
| --- | --- | --- | --- |
| Identity source | Veeva/Entra federated user | Veeva Vault session | Ping Federate bearer token via Kong |
| Databricks caller | Individual user | Fixed service principal | Fixed service principal |
| Databricks user provisioning | Required | Not required | Not required |
| Per-user row scoping | Native row filters | Claim-scoped views (Federated ID) | Claim-scoped views (`mudid`) |
| Who authenticates the user | Databricks (token exchange) | The broker (Vault API) | Kong (Ping token), trusted by the broker |

Choose this variant when reps are authenticated through Ping Federate and identified by `mudid`, and a gateway (Kong) already fronts the API.

## Security boundary

The broker trusts Kong to authenticate the Ping bearer token. It must therefore be reachable only through Kong — not directly from the public internet — because it does not re-verify the token signature, issuer, or audience. The identity claim is derived only from the forwarded token, never from browser input. The service-principal secret controls both Databricks access and, through the claim, row access; keep it in a secret manager and rotate it.

If you prefer the broker to verify the Ping token itself (issuer, audience, signature via Ping's JWKS) rather than trust Kong, that is a localized change in `src/pingIdentity.ts` — add JWKS-based verification before reading the claim.

## References

- [Databricks: OAuth machine-to-machine authentication](https://learn.microsoft.com/en-us/azure/databricks/dev-tools/auth/oauth-m2m)
- [Databricks: current_oauth_custom_identity_claim](https://docs.databricks.com/aws/en/sql/language-manual/functions/current_oauth_custom_identity_claim)
- [Kong Gateway: forwarding upstream headers](https://docs.konghq.com/gateway/latest/)
