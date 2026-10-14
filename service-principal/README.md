# Veeva X-Page with a fixed Databricks service principal

This directory is a complete, independent alternative to the per-user federation implementation at the repository root. It includes its own React X-Page, broker, dependencies, tests, build scripts, package, and deployment configuration.

Veeva still authenticates the human user. On iPad and iPhone, the X-Page reuses the active native Vault session without opening a login screen. Databricks calls use one fixed workspace service principal, so every user shares its Unity Catalog grants. Each token also carries an OAuth identity claim for the verified Veeva user. A claim-scoped directory view decides which Genie Agents that user's Veeva roles include, and claim-scoped data views limit the rows the user sees inside each Agent.

## Identity flow

```text
Veeva Vault CRM X-Page
        |
        | ds.getVaultSessionId() (silent; no OAuth window)
        v
Independent service-principal broker
        |  1. validates the session with the allowlisted Vault `/objects/users/me` API
        |  2. derives the identity claim (Vault username or Federated ID)
        |  3. obtains a Databricks OAuth M2M token carrying that claim
        |  4. reads the user's Genie Agents from a claim-scoped directory view
        |  5. binds each Genie conversation to its Agent and claim with a signed ticket
        |  6. correlates the Veeva actor in structured audit logs
        v
Fixed Databricks service principal + identity claim
        |
        +--> chat and Agent mode APIs of the Genie Agent the user selected
        +--> query-result and visualization APIs
        +--> claim-scoped views: rows filtered by current_oauth_custom_identity_claim()
```

The Vault session is used only to bootstrap a short-lived encrypted broker session and is discarded after validation. The service-principal secret and Databricks access token never enter the X-Page. By default, the broker session lasts 15 minutes; the X-Page silently revalidates its active Vault session before expiry while it remains open.

The broker mints one Databricks token per identity claim, caches it per claim, and uses it only after confirming the returned JWT carries the exact claim for the service principal; otherwise it fails closed. The claim is always derived from the Vault-verified user — never from browser input.

## Request flow and conversation binding

After login, the X-Page sends questions to the broker, which calls the Genie chat and Agent mode APIs with the service principal's claim-bearing token. Because every X-Page user shares one service principal, Genie treats them as the same caller and would otherwise let any user open any conversation — including stored results computed under another user's identity claim.

The broker binds each conversation to the claim that started it:

- When a conversation starts, the broker returns a `conversation_ticket`: an HMAC over the Genie Agent, conversation ID, and identity claim. Agent mode delivers the ticket as a `broker.conversation` stream event, because the conversation ID first appears mid-stream.
- Every later call — follow-up messages, query results, visualizations, and Agent-mode items — must present that ticket in the `X-Conversation-Ticket` header. A ticket verifies only for the same Agent, conversation, and claim; a ticket from another user's session is rejected with HTTP 403.
- Tickets and the broker session are self-contained (signed/encrypted), so the broker holds no per-conversation server state and can run as more than one instance.

## Choosing a Genie Agent by Veeva role

Each Veeva user sees only the Genie Agents their Veeva roles include. Genie space permissions cannot express this, because every user reaches Databricks as the same service principal. The decision is therefore keyed on the identity claim, like row scoping:

| Object | Purpose | Service principal access |
| --- | --- | --- |
| `genie_access.user_roles` | Identity claim to Veeva role; in production, synced from Vault CRM group membership | None |
| `genie_access.role_agents` | Veeva role to Genie Agent IDs, maintained on the Databricks side | None |
| `genie_access.my_genie_agents` | Claim-scoped view: the caller's Agent IDs, matched on `current_oauth_custom_identity_claim()` | `SELECT` |

When a broker session starts, the broker queries `my_genie_agents` with the user's claim-bearing token and labels each Agent with its Genie space title and description. It leaves out any Agent the service principal cannot open, seals the remaining Agent IDs into the encrypted session, and returns the list to the X-Page.

- With several Agents, the X-Page shows a selector and marks the one last used. With one, it opens that Agent directly. With none, it explains that no Veeva role grants an Agent.
- Every Genie route names its Agent (`/api/agents/{agentId}/chat/...` and `/api/agents/{agentId}/research/...`). The broker refuses any Agent missing from the sealed session with HTTP 403 `agent_not_entitled`. The selector is presentation only.
- Conversation tickets name the Agent, so a conversation cannot be continued on a different Agent.
- The directory is read again for every broker session, so removing a role takes effect within one session lifetime (15 minutes by default). The X-Page closes an open Agent that disappears from a renewed session.
- Inside every Agent, rows are still limited by the claim-scoped data views. Removing the Agent layer would not widen row access.

## Configured demo resources

| Resource | Value |
| --- | --- |
| Workspace | `adb-7405608383447105.5.azuredatabricks.net` |
| Genie Agents | `01f1c1bc36b518d7b7a59b21c1bd3b92` (HEOR Cohort Explorer), `01f1c81534111e01b8b3957dbc9cc314` (Field Medical Biomarker Explorer); both claim-scoped |
| Agent directory view | `af_vault_genie_demo.genie_access.my_genie_agents` |
| SQL warehouse | `befedd56fadee1fa` |
| Service principal | `veeva-xpage-genie-shared` |
| Application ID | `6d18456b-9dba-4ca9-9e65-d2843df4dd7a` |
| Curated table | `af_vault_genie_demo.nsclc_rwe.gold_patient_master` |
| Claim-scoped view | `af_vault_genie_demo.nsclc_rwe_scoped.gold_patient_master_scoped` |
| Identity claim source | `federated_id` (`antonio.farias@databricks.com`) |
| Demo entitlements | `antonio.farias@databricks.com` → `SITE-0001` (13 patients); `demo.msl.west@example.com` → `SITE-0002`, `SITE-0003` (26 patients) |
| Demo roles | `antonio.farias@databricks.com` → `heor_analyst`, `field_medical` (both Agents); `demo.msl.west@example.com` → `field_medical` (one Agent) |

The project grants the service principal workspace access, Databricks SQL entitlement, `CAN_RUN` on each Genie Agent, `CAN_USE` on the warehouse, and the required Unity Catalog `USE` and `SELECT` privileges. Row scoping takes effect once the Genie Agent references only the claim-scoped view and the service principal loses direct access to the curated table; see [Row scoping with identity claims](#row-scoping-with-identity-claims).

> Sandbox caveat: this Azure Databricks account currently grants `account_admin` indirectly to its built-in account `users` group. The demo service principal therefore inherits broader account authority even though this project adds only the scoped permissions above. Do not reproduce that group role in a customer environment; remove it from the built-in group or use an account where default principals are not administrators before treating this as a least-privilege production deployment.

## Repointing to another workspace or Genie Agents

Nothing is hard-coded in source — the workspace and Genie Agents are read from configuration at runtime. There are two config files because there are two deployables, and the split is deliberate: **the browser file must never contain a secret.**

| What to change | Browser — `public/xpage-config.js` | Broker — `.env` locally, or App Service application settings |
| --- | --- | --- |
| Workspace | `workspaceHost`, `workspaceOrgId` | `DBX_WORKSPACE_HOST` |
| Genie Agents by Veeva role | — | `GENIE_AGENT_DIRECTORY_VIEW` and `DBX_WAREHOUSE_ID` |
| One Genie Agent for every user | — | `DBX_GENIE_AGENT_ID` (instead of the directory view) |
| Broker URL | `authBrokerBaseUrl` | — |
| Vault instance | — | `VEEVA_VAULT_ALLOWED_ORIGINS` |
| X-Page origin allowlist | — | `ALLOWED_PARENT_ORIGINS` |
| Identity claim source | — | `IDENTITY_CLAIM_SOURCE` (`user_name` or `federated_id`) |

`workspaceHost` / `DBX_WORKSPACE_HOST` must match across the two files. The X-Page has no Agent setting: it shows the Agents the broker lists, titled by their Genie spaces. Only the broker file holds secrets (`DBX_SP_CLIENT_SECRET`, `STATE_ENCRYPTION_SECRET`); never place those in `public/xpage-config.js`, which ships to the browser.

To hand this to someone or point it at a new environment:

1. Edit `public/xpage-config.js`, then rebuild and repackage: `npm run package:xpage`. Re-upload `artifacts/vault-crm-genie-service-principal-xpage.zip` as the Veeva X-Page content package.
2. Set the broker values in `.env` (local) or the App Service application settings (deployed), then restart the broker.

> If you prefer a single source of truth, the broker could serve the non-secret browser values from a `GET /api/config` endpoint that the X-Page reads at startup. It is not wired up today because it adds a blocking request to login; the two-file split keeps login fast and keeps secrets off the browser.

## Build the independent X-Page

From this directory:

```bash
npm ci
npm run lint
npm test
npm run package:xpage
```

`npm test` runs the X-Page unit tests, including Research-mode parsing against a captured Agent mode response (`src/lib/__fixtures__/`).

Output:

```text
artifacts/vault-crm-genie-service-principal-xpage.zip
```

Upload the ZIP directly as a separate Veeva X-Page content package. It contains `index.html` at the archive root.

## Configure and run the independent broker

```bash
cd broker
cp .env.example .env
npm ci
npm test
npm start
```

Set `DBX_SP_CLIENT_SECRET` and `STATE_ENCRYPTION_SECRET` only in the broker's secret store or encrypted application settings.

`public/xpage-config.js` contains only non-secret browser settings, including the independent broker URL. This implementation does not require an X-Pages SSO Configuration.

The checked-in sandbox configuration targets:

```text
https://af-vault-genie-sp-eus2-20260929.azurewebsites.net
```

It runs on a separate free App Service plan from the per-user broker. Free-tier CPU and restart quotas are suitable for a demo, not for production availability.

## Row scoping with identity claims

Databricks OAuth lets the service principal's token carry an opaque `custom_claim`. SQL reads it with `current_oauth_custom_identity_claim()`, which raises `OAUTH_CUSTOM_IDENTITY_CLAIM_NOT_PROVIDED` when a caller has none. The claim reaches the SQL engine through Genie chat and Agent mode, and the SQL result cache is kept separately per claim.

Set up the demo in this order:

1. Run `ops/create_identity_claim_rls.sql` as a catalog administrator. It creates the entitlement table, the treating-site dimension, and the runtime service principal's `USE` grants.
2. Create the view. Databricks evaluates the claim function while creating any object that references it, so neither the SQL editor nor a SQL UDF wrapper can create it. Give an administration service principal `CREATE TABLE` on `af_vault_genie_demo.nsclc_rwe_scoped` and `SELECT` on `gold_patient_master`, `user_entitlements`, and `patient_care_site`, then run:

   ```bash
   DBX_WORKSPACE_HOST=adb-7405608383447105.5.azuredatabricks.net \
   DBX_WAREHOUSE_ID=befedd56fadee1fa \
   DBX_DDL_SP_CLIENT_ID=<admin service principal> \
   DBX_DDL_SP_CLIENT_SECRET=<secret> \
   DBX_RUNTIME_SP_APPLICATION_ID=6d18456b-9dba-4ca9-9e65-d2843df4dd7a \
   VIEW_OWNER=<admin user or group> \
   node ops/apply-claim-scoped-view.mjs
   ```

   The script grants the runtime service principal `SELECT` on the view and hands ownership to `VIEW_OWNER`. Revoke the administration grants afterwards. To change the view later, transfer its ownership back to the administration service principal first.
3. Create each Genie Agent so its only tables are claim-scoped views, and grant the runtime service principal `CAN_RUN` on it. Leave prompt matching off for scoped columns, because value indexes are built outside any user's claim.
4. Run `ops/create_genie_agent_directory.sql` as a catalog administrator. It creates the role tables, the demo roles, and the runtime service principal's `USE SCHEMA` grant. Then create the directory view the same way as step 2: give the administration service principal `CREATE TABLE` on `af_vault_genie_demo.genie_access` and `SELECT` on `user_roles` and `role_agents`, and run

   ```bash
   node ops/apply-claim-scoped-view.mjs ops/genie_agent_directory_view.sql
   ```

   with the same environment variables. Set `GENIE_AGENT_DIRECTORY_VIEW=af_vault_genie_demo.genie_access.my_genie_agents` and `DBX_WAREHOUSE_ID` on the broker.
5. Cut over by revoking the runtime service principal's direct access to the curated table:

   ```sql
   REVOKE SELECT ON TABLE af_vault_genie_demo.nsclc_rwe.gold_patient_master FROM `6d18456b-9dba-4ca9-9e65-d2843df4dd7a`;
   ```

Operational consequences:

- People and tools without a claim, including Genie authors in the Databricks UI, cannot query the scoped view. Validate the Agent through the broker or with claim-bearing test tokens.
- Users with `CAN_MANAGE` on the Genie Agent can open every user's conversations and stored results. Keep that permission to a small administrator group.
- An empty claim is valid to Databricks. The broker rejects it, and the entitlement table's `canonical_claim_key` constraint keeps empty or non-canonical keys out.

## Authorization behavior

Databricks sees the fixed service principal as the caller. Therefore:

- All X-Page users share its catalog, schema, warehouse, and Genie Agent grants. The directory view narrows which Agents each user can open through the broker.
- Claim-scoped views limit rows to the entitlements of each user's identity claim. Unity Catalog row filters, column masks, and group checks keyed on `current_user()` still evaluate the service principal.
- Databricks query history and audit logs identify the service principal and do not record the claim.
- Structured broker logs correlate the Veeva user, identity claim, broker session, service principal, Genie Agent, conversation, message, attachment, and statement identifiers.
- Prompts and result contents are intentionally excluded from broker audit logs.

## Choosing between the two implementations

| Question | Per-user implementation | Service-principal implementation |
| --- | --- | --- |
| Databricks caller | Individual Veeva/Entra user | Fixed service principal |
| Databricks user provisioning | Required | Not required for X-Page users |
| Account federation policy | Required | Not required |
| User-specific UC grants | Preserved | Not preserved |
| Per-user row scoping | Native row filters, groups, and `current_user()` | Claim-scoped views and an entitlement table |
| Databricks audit identity | Individual user | Shared service principal |
| Compensating application audit | Helpful | Required |
| Credential stored by broker | Session encryption secret | Session secret plus SP OAuth secret |

Choose per-user federation when individual Databricks grants and Databricks-native attribution are requirements. Choose this implementation when users should not become Databricks identities and their row access can be expressed as entitlements keyed by a Vault identity.

## Security boundary

The broker does not treat CORS or an opaque iOS origin as authentication. Every application session requires a current Vault session ID, which the broker validates directly against the Vault API. The submitted Vault URL must match an exact server-side allowlist. The raw Vault session is never logged or retained in the encrypted broker session.

This zero-click path is designed for Vault CRM on iPad and iPhone, where Veeva documents `getVaultSessionId()` as the native integration mechanism. It reuses the user's existing Vault CRM app login; it does not sign the user into Databricks. Genie requests run as the fixed service principal.

The identity claim is asserted by whoever holds the service-principal secret; Databricks does not verify it. The broker derives it only from the Vault-verified user, never from browser input, so the secret now controls row access as well as Databricks access. Keep it in a secret manager and rotate it.

## References

- [Veeva: Integrating External Data with X-Pages](https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/X_Pages/CustomizeX_Pages/IntegrateExtData.htm)
- [Veeva X-Pages Library: `getVaultSessionId()`](https://developer.veevacrm.com/doc/Content/CRM_topics/Vault/x-pages-library.htm#getVaultSessionId)
- [Vault API: Validate Session User](https://general.veevavault.dev/vault-api/api-reference/25.3/users/validate-session-user)
- [Databricks: OAuth machine-to-machine authentication](https://learn.microsoft.com/en-us/azure/databricks/dev-tools/auth/oauth-m2m)
