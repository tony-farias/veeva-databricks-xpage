# Veeva CRM MyInsights page with a fixed Databricks service principal

This directory is the Veeva CRM (Salesforce) counterpart of [`service-principal/`](../service-principal/), which targets Vault CRM X-Pages. It includes its own React MyInsights page, broker, dependencies, tests, build scripts, package, and deployment configuration. The Databricks side is identical: the same broker design, shared service principal, OAuth identity claim, claim-scoped views, and Genie Agent.

Veeva CRM still authenticates the human user. The MyInsights page reuses the user's active Salesforce session without opening a login screen. Databricks calls use one fixed workspace service principal, so every user shares its Genie Agent and Unity Catalog grants. Each token also carries an OAuth identity claim for the verified Veeva CRM user, and claim-scoped views limit the rows that user can see.

## What changes from the Vault CRM variant

| Area | Vault CRM (`service-principal/`) | Veeva CRM (this directory) |
| --- | --- | --- |
| Packaging | X-Page content package (`html_report__v`) | MyInsights content: a ZIP attached to an `HTML_Report_vod__c` record |
| JavaScript library | X-Pages library (`X-PagesLibrary.js`) | MyInsights library (`myinsights-v2-0.js` or later) |
| Session call | `ds.getVaultSessionId()` | `ds.getSFDCSessionID()` |
| Broker verification | Vault `/objects/users/me` | Salesforce SOAP `getUserInfo()`, plus an organization ID allowlist |
| Identity claim | `user_name__v` or `federated_id__sys` | `User.Username` or `User.FederationIdentifier` |
| Broker origin allowlist | Vault CRM domains | Salesforce-hosted MyInsights domains, or the opaque iPad origin |
| Databricks, Genie, Unity Catalog | — | Unchanged |

`ds.request()` and `ds.getSSOAccessToken(authIdentifier, providerName, oldToken)` also exist in the MyInsights library. This variant does not need SSO: like the Vault CRM variant, it bootstraps from the CRM session.

## Identity flow

```text
Veeva CRM MyInsights page
        |
        | ds.getSFDCSessionID() (silent; no OAuth window)
        v
Independent service-principal broker
        |  1. checks the instance URL against an exact allowlist
        |  2. validates the session with Salesforce SOAP getUserInfo()
        |  3. requires the session's organization ID to be allowlisted
        |  4. derives the identity claim (Username or Federation ID)
        |  5. obtains a Databricks OAuth M2M token carrying that claim
        |  6. binds each Genie conversation to the claim with a signed ticket
        |  7. correlates the Veeva CRM actor in structured audit logs
        v
Fixed Databricks service principal + identity claim
        |
        +--> Genie Agent chat and Agent mode APIs
        +--> query-result and visualization APIs
        +--> claim-scoped views: rows filtered by current_oauth_custom_identity_claim()
```

The Salesforce session is used only to bootstrap a short-lived encrypted broker session and is discarded after validation. The service-principal secret and Databricks access token never enter the MyInsights page. By default, the broker session lasts 15 minutes; the page silently revalidates its active Salesforce session before expiry while it remains open.

The broker mints one Databricks token per identity claim, caches it per claim, and uses it only after confirming the returned JWT carries the exact claim for the service principal; otherwise it fails closed. The claim is always derived from the Salesforce-verified user, never from browser input.

`getSFDCSessionID()` returns a Salesforce UI session ID rather than a connected-app OAuth token. Salesforce's OAuth `userinfo` endpoint can reject those sessions, so the broker uses SOAP `getUserInfo()`, which accepts any API-enabled session. Veeva CRM users need the **API Enabled** permission, which they normally already have for iPad sync.

## Request flow and conversation binding

After login, the page sends questions to the broker, which calls the Genie chat and Agent mode APIs with the service principal's claim-bearing token. Because every user shares one service principal, Genie treats them as the same caller and would otherwise let any user open any conversation, including stored results computed under another user's identity claim.

The broker binds each conversation to the claim that started it:

- When a conversation starts, the broker returns a `conversation_ticket`: an HMAC over the Genie Agent, conversation ID, and identity claim. Agent mode delivers the ticket as a `broker.conversation` stream event, because the conversation ID first appears mid-stream.
- Every later call (follow-up messages, query results, visualizations, and Agent-mode items) must present that ticket in the `X-Conversation-Ticket` header. A ticket verifies only for the same Agent, conversation, and claim; a ticket from another user's session is rejected with HTTP 403.
- Tickets and the broker session are self-contained (signed/encrypted), so the broker holds no per-conversation server state and can run as more than one instance.

## Configured demo resources

The Databricks resources are shared with the Vault CRM variant:

| Resource | Value |
| --- | --- |
| Workspace | `adb-7405608383447105.5.azuredatabricks.net` |
| Genie Agent | `01f1c1bc36b518d7b7a59b21c1bd3b92` (claim-scoped) |
| SQL warehouse | `befedd56fadee1fa` |
| Service principal | `veeva-xpage-genie-shared` |
| Application ID | `6d18456b-9dba-4ca9-9e65-d2843df4dd7a` |
| Curated table | `af_vault_genie_demo.nsclc_rwe.gold_patient_master` |
| Claim-scoped view | `af_vault_genie_demo.nsclc_rwe_scoped.gold_patient_master_scoped` |
| Demo entitlements | `antonio.farias@databricks.com` → `SITE-0001` (13 patients); `demo.msl.west@example.com` → `SITE-0002`, `SITE-0003` (26 patients) |

No Veeva CRM broker is deployed for the demo yet, so `authBrokerBaseUrl` in `public/myinsights-config.js` is a `REPLACE-ME` placeholder and the page reports a configuration problem until it is set.

## Validation status

- Broker unit tests cover session verification, organization pinning, Federation ID lookup, and SOAP escaping against a fake Salesforce server.
- The Salesforce verification was run against a real Salesforce org's API, and a Genie question was answered end to end through the broker with that user's claim (the user had no entitlements, so the scoped view correctly returned 0 patients).
- The page has not yet run inside Veeva CRM MyInsights. The first test in a customer sandbox should confirm the `getSFDCSessionID()` response, the page origin to allowlist, and any Content Security Policy requirement.

## Configuration

Nothing is hard-coded in source; the workspace and Genie Agent are read from configuration at runtime. There are two config files because there are two deployables, and **the browser file must never contain a secret.**

| What to change | Browser: `public/myinsights-config.js` | Broker: `.env` locally, or App Service application settings |
| --- | --- | --- |
| Workspace | `workspaceHost`, `workspaceOrgId` | `DBX_WORKSPACE_HOST` |
| Genie Agent | `genieAgentId` | `DBX_GENIE_AGENT_ID` |
| Broker URL | `authBrokerBaseUrl` | — |
| Shared service principal | — | `DBX_SP_CLIENT_ID`, `DBX_SP_CLIENT_SECRET`, `DBX_SP_DISPLAY_NAME` |
| Salesforce instance | — | `SALESFORCE_ALLOWED_ORIGINS` (the `instanceURL` from `getSFDCSessionID()`) |
| Salesforce organization | — | `SALESFORCE_ORG_IDS` |
| Salesforce API version | — | `SALESFORCE_API_VERSION` (for example `v62.0`) |
| MyInsights page origin allowlist | — | `ALLOWED_PARENT_ORIGINS`, `ALLOW_OPAQUE_PARENT_ORIGIN`, `ALLOW_SALESFORCE_PARENT_ORIGINS` |
| Identity claim source | — | `IDENTITY_CLAIM_SOURCE` (`username` or `federation_id`) |
| Header and context labels (cosmetic) | `displayName`, `contextLabel` | — |

`workspaceHost` / `DBX_WORKSPACE_HOST` and `genieAgentId` / `DBX_GENIE_AGENT_ID` must match across the two files. Only the broker holds secrets (`DBX_SP_CLIENT_SECRET`, `STATE_ENCRYPTION_SECRET`).

## Build the MyInsights package

Veeva distributes the MyInsights library through the Veeva CRM Developer Portal rather than a public CDN, so the build reads a downloaded copy. It is copied into the package and is never committed (`public/vendor` is gitignored).

From this directory:

```bash
npm ci
npm run lint
npm test
VEEVA_MYINSIGHTS_LIBRARY_PATH=/path/to/myinsights-v2-0.js npm run package:myinsights
```

`npm test` runs the page's unit tests, including Research-mode parsing against a captured Agent mode response (`src/lib/__fixtures__/`).

Output:

```text
artifacts/veeva-crm-genie-myinsights.zip
```

The ZIP contains `index.html` at the archive root. The build emits one classic script bundle (no ES modules), because the Veeva CRM iPad app opens downloaded MyInsights content from `file://`.

## Deploy in Veeva CRM

1. Deploy the broker (below) and set `authBrokerBaseUrl` in `public/myinsights-config.js`, then rebuild the package.
2. Create an `HTML_Report_vod__c` record with the record type for where the page should appear (for example, the account profile or the home page), attach `veeva-crm-genie-myinsights.zip`, and make it visible to the target users. MyInsights Studio can be used instead. Follow Veeva's MyInsights administration documentation for the record types and visibility settings in your org.
3. Allow the page to reach the broker:
   - **Online (browser):** MyInsights content runs on a Salesforce-hosted domain. Open the page once; if the broker logs `security.origin_rejected`, add the logged origin to `ALLOWED_PARENT_ORIGINS` (or set `ALLOW_SALESFORCE_PARENT_ORIGINS=true`). If the browser console reports a Content Security Policy block, add the broker URL as a CSP Trusted Site that allows `connect-src`.
   - **iPad:** downloaded content has an opaque origin. Set `ALLOW_OPAQUE_PARENT_ORIGIN=true`; the Salesforce session is still required and validated.
4. Key the entitlement table on the same lowercase value as `IDENTITY_CLAIM_SOURCE`: the Federation ID (usually the SSO subject, such as the user's corporate email or employee ID) or the Salesforce username.

## Configure and run the broker

```bash
cd broker
cp .env.example .env
npm ci
npm test
npm start
```

Set `DBX_SP_CLIENT_SECRET` and `STATE_ENCRYPTION_SECRET` only in the broker's secret store or encrypted application settings. The broker is a plain Node.js/Express server; it runs on Azure App Service (zip or the included `Dockerfile`) like the Vault CRM broker. No Salesforce connected app, Auth. Provider, or SSO configuration is required.

## Row scoping with identity claims

Databricks OAuth lets the service principal's token carry an opaque `custom_claim`. SQL reads it with `current_oauth_custom_identity_claim()`, which raises `OAUTH_CUSTOM_IDENTITY_CLAIM_NOT_PROVIDED` when a caller has none. The claim reaches the SQL engine through Genie chat and Agent mode, and the SQL result cache is kept separately per claim.

The `ops/` scripts create the same objects as the Vault CRM variant's, so one claim-scoped Genie Agent can serve both. Rerunning `create_identity_claim_rls.sql` replaces the shared entitlement table. To set it up from scratch:

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

   The script grants the runtime service principal `SELECT` on the view and hands ownership to `VIEW_OWNER`. Revoke the administration grants afterwards.
3. Create a Genie Agent whose only table is the claim-scoped view, grant the runtime service principal `CAN_RUN`, and set `DBX_GENIE_AGENT_ID`. Leave prompt matching off for scoped columns, because value indexes are built outside any user's claim.
4. Cut over by revoking the runtime service principal's direct access to the curated table.

Operational consequences:

- People and tools without a claim, including Genie authors in the Databricks UI, cannot query the scoped view. Validate the Agent through the broker or with claim-bearing test tokens.
- Users with `CAN_MANAGE` on the Genie Agent can open every user's conversations and stored results. Keep that permission to a small administrator group.
- An empty claim is valid to Databricks. The broker rejects it, and the entitlement table's `canonical_claim_key` constraint keeps empty or non-canonical keys out.

## Authorization behavior

Databricks sees the fixed service principal as the caller. Therefore:

- All users share its catalog, schema, warehouse, and Genie Agent grants.
- Claim-scoped views limit rows to the entitlements of each user's identity claim. Unity Catalog row filters, column masks, and group checks keyed on `current_user()` still evaluate the service principal.
- Databricks query history and audit logs identify the service principal and do not record the claim.
- Structured broker logs correlate the Veeva CRM user, Salesforce organization, identity claim, broker session, service principal, Genie Agent, conversation, message, attachment, and statement identifiers.
- Prompts and result contents are intentionally excluded from broker audit logs.

## Security boundary

The broker does not treat CORS or an opaque iOS origin as authentication. Every application session requires a current Salesforce session ID, which the broker validates directly against the Salesforce API. The submitted instance URL must match an exact server-side allowlist, and the session's organization must match `SALESFORCE_ORG_IDS`. The raw Salesforce session is never logged or retained in the encrypted broker session.

The identity claim is asserted by whoever holds the service-principal secret; Databricks does not verify it. The broker derives it only from the Salesforce-verified user, never from browser input, so the secret now controls row access as well as Databricks access. Keep it in a secret manager and rotate it.

## References

- [Veeva CRM: Integrating External Data with MyInsights](https://crmhelp.veeva.com/doc/Content/CRM_topics/MyInsights/MyInsightsAdvFunct/IntegrateExtData.htm)
- [Veeva CRM Developer Portal: MyInsights library](https://developer.veevacrm.com/doc/Content/CRM_topics/Veeva/myinsights-veeva.htm)
- [Salesforce SOAP API: `getUserInfo()`](https://developer.salesforce.com/docs/atlas.en-us.api.meta/api/sforce_api_calls_getuserinfo.htm)
- [Databricks: OAuth machine-to-machine authentication](https://learn.microsoft.com/en-us/azure/databricks/dev-tools/auth/oauth-m2m)
