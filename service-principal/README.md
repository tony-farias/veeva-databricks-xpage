# Veeva X-Page with a fixed Databricks service principal

This directory is a complete, independent alternative to the per-user federation implementation at the repository root. It includes its own React X-Page, broker, dependencies, tests, build scripts, package, and deployment configuration.

Veeva still authenticates the human user. On iPad and iPhone, the X-Page reuses the active native Vault session without opening a login screen. Databricks calls use one fixed workspace service principal, so every user receives the same curated Genie Agent and Unity Catalog authorization boundary.

## Identity flow

```text
Veeva Vault CRM X-Page
        |
        | ds.getVaultSessionId() (silent; no OAuth window)
        v
Independent service-principal broker
        |  1. validates the session with the allowlisted Vault `/objects/users/me` API
        |  2. obtains a Databricks OAuth M2M token
        |  3. correlates the Veeva actor in structured audit logs
        v
Fixed Databricks service principal
        |
        +--> Genie Agent chat and Agent mode APIs
        +--> query-result and visualization APIs
        +--> curated warehouse and Unity Catalog permissions
```

The Vault session is used only to bootstrap a short-lived encrypted broker session and is discarded after validation. The service-principal secret and Databricks access token never enter the X-Page. By default, the broker session lasts 15 minutes; the X-Page silently revalidates its active Vault session before expiry while it remains open.

## Configured demo resources

| Resource | Value |
| --- | --- |
| Workspace | `adb-7405615520098858.18.azuredatabricks.net` |
| Genie Agent | `01f1b959138b1575a09b54923fa27532` |
| SQL warehouse | `9515e3337e0471aa` |
| Service principal | `veeva-xpage-genie-shared` |
| Application ID | `7cf9fe9b-c14f-4b9f-8fcf-a094f0421c7b` |
| Curated table | `af_vault_genie_demo.nsclc_rwe.gold_patient_master` |

The project grants the service principal workspace access, Databricks SQL entitlement, `CAN_RUN` on the Genie Agent, `CAN_USE` on the warehouse, and the required Unity Catalog `USE` and `SELECT` privileges for the demo table.

> Sandbox caveat: this Azure Databricks account currently grants `account_admin` indirectly to its built-in account `users` group. The demo service principal therefore inherits broader account authority even though this project adds only the scoped permissions above. Do not reproduce that group role in a customer environment; remove it from the built-in group or use an account where default principals are not administrators before treating this as a least-privilege production deployment.

## Build the independent X-Page

From this directory:

```bash
npm ci
npm run lint
npm run package:xpage
```

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

## Authorization behavior

Databricks sees the fixed service principal as the caller. Therefore:

- All X-Page users share its catalog, schema, table, row-filter, column-mask, warehouse, and Genie Agent access.
- Databricks query history and audit logs identify the service principal.
- User-specific Databricks grants or RLS do not apply.
- Structured broker logs correlate the Veeva user, broker session, service principal, Genie Agent, conversation, message, and attachment identifiers.
- Prompts and result contents are intentionally excluded from broker audit logs.

## Choosing between the two implementations

| Question | Per-user implementation | Service-principal implementation |
| --- | --- | --- |
| Databricks caller | Individual Veeva/Entra user | Fixed service principal |
| Databricks user provisioning | Required | Not required for X-Page users |
| Account federation policy | Required | Not required |
| User-specific UC grants and RLS | Preserved | Not preserved |
| Databricks audit identity | Individual user | Shared service principal |
| Compensating application audit | Helpful | Required |
| Credential stored by broker | Session encryption secret | Session secret plus SP OAuth secret |

Choose per-user federation when individual data authorization and Databricks-native attribution are requirements. Choose this implementation when all users should see the same deliberately curated dataset and simpler Databricks user lifecycle is more important.

## Security boundary

The broker does not treat CORS or an opaque iOS origin as authentication. Every application session requires a current Vault session ID, which the broker validates directly against the Vault API. The submitted Vault URL must match an exact server-side allowlist. The raw Vault session is never logged or retained in the encrypted broker session.

This zero-click path is designed for Vault CRM on iPad and iPhone, where Veeva documents `getVaultSessionId()` as the native integration mechanism. It reuses the user's existing Vault CRM app login; it does not sign the user into Databricks. Genie requests run as the fixed service principal.

## References

- [Veeva: Integrating External Data with X-Pages](https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/X_Pages/CustomizeX_Pages/IntegrateExtData.htm)
- [Veeva X-Pages Library: `getVaultSessionId()`](https://developer.veevacrm.com/doc/Content/CRM_topics/Vault/x-pages-library.htm#getVaultSessionId)
- [Vault API: Validate Session User](https://general.veevavault.dev/vault-api/api-reference/25.3/users/validate-session-user)
- [Databricks: OAuth machine-to-machine authentication](https://learn.microsoft.com/en-us/azure/databricks/dev-tools/auth/oauth-m2m)
