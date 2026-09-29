# Veeva Vault CRM + Databricks Genie Agent X-Page

A responsive, headless Databricks Genie Agent experience for Veeva Vault CRM X-Pages. It gives users conversational analytics, generated SQL, tabular evidence, visualizations, and Research mode without embedding the Databricks web UI in an iframe.

The application is designed for Vault CRM on iPad. Veeva supplies the signed-in user's Microsoft Entra assertion through the native X-Pages SSO bridge. A small broker exchanges that assertion for a short-lived Databricks token representing the same user, so Unity Catalog permissions and audit attribution remain user-specific.

## What is included

- React and TypeScript X-Page UI modeled on the Databricks Genie interface
- Native Veeva X-Pages SSO integration
- Per-user Databricks OAuth federation exchange
- Genie Agent chat with follow-up conversations
- Generated SQL and governed query-result tables
- PNG visualization discovery and rendering, including bare attachment IDs
- Accessible table fallback when a visualization is unavailable
- Research/Agent mode response streaming
- Responsive iPad layout with no iframe, popup, Databricks cookie, or Safari handoff
- Node.js/Express authentication and API broker
- Synthetic NSCLC demonstration data with no PHI

## Architecture

```text
Veeva Vault CRM X-Page
        |
        | ds.getSSOAccessToken(...)
        v
Veeva-managed Entra user assertion
        |
        | HTTPS
        v
Authentication/API broker
        |
        | OAuth token exchange
        v
Databricks token for the individual user
        |
        +--> Genie Agent chat APIs
        +--> query-result API
        +--> visualization download API
        +--> Research/Agent response stream
        |
        v
Unity Catalog data and SQL warehouse
```

The browser never receives the Databricks access token. The broker returns an encrypted, short-lived application session and pins requests to one configured Genie Agent.

## Choose an identity model

This repository now contains two complete X-Page implementations so a customer can choose the authorization model that fits its requirements:

| Implementation | Databricks caller | Best fit |
| --- | --- | --- |
| Repository root | Individual Veeva/Entra user | Preserve each user's Unity Catalog permissions, row filters, column masks, and Databricks audit identity |
| [`service-principal/`](service-principal/) | Fixed workspace service principal | Give all X-Page users one deliberately curated data boundary without provisioning each user in Databricks |

The service-principal implementation is independent: it has its own React application, broker, dependencies, build scripts, documentation, and deployment configuration. Databricks records the shared service principal for those requests, while the broker maintains a compensating audit correlation to the verified Veeva user.

## Repository layout

```text
src/                         X-Page React application
public/xpage-config.js       Non-secret X-Page runtime configuration
broker/                      Authentication and Databricks API broker
service-principal/            Independent fixed-service-principal alternative
ops/                         Synthetic-data and demo SQL
scripts/                     X-Page build and packaging scripts
PRODUCT.md                   Product and UX context
DESIGN.md                    UI design system
DEMO.md                      Demonstration guide
```

## Requirements

- Node.js 20.19+, 22.13+, or 24+
- A Veeva Vault CRM X-Page SSO configuration
- An Azure Databricks workspace with OAuth token federation configured
- A Genie Agent shared with the intended users
- A SQL warehouse and Unity Catalog data accessible to those users
- An HTTPS host for the broker

## Configure the X-Page

Edit `public/xpage-config.js`. It contains no secret values.

```js
window.__GENIE_XPAGE_CONFIG__ = Object.freeze({
  workspaceHost: "adb-<workspace-id>.<region>.azuredatabricks.net",
  workspaceOrgId: "<workspace-id>",
  genieAgentId: "<genie-agent-id>",
  authBrokerBaseUrl: "https://<broker-host>",
  ssoConfigurationName: "<veeva-sso-configuration-name>",
  defaultMode: "chat",
  displayName: "Clinical Genie",
  contextLabel: "Governed by Unity Catalog",
});
```

For the current implementation, the broker separately allowlists the same workspace and Genie Agent. This duplication prevents a modified browser configuration from using the broker to access an arbitrary Agent.

## Build the X-Page package

```bash
npm ci
npm run lint
npm run package:xpage
```

The build creates:

```text
artifacts/vault-crm-genie-xpage.zip
```

Upload that ZIP directly as the Veeva X-Page content package. Do not unzip it first. The package already has `index.html` at its root and uses relative asset paths suitable for the Veeva CDN and iPad application.

## Configure the broker

Copy the example environment file and provide deployment-specific values:

```bash
cd broker
cp .env.example .env
npm ci
npm test
npm run build
```

Important settings include:

| Setting | Purpose |
| --- | --- |
| `DBX_WORKSPACE_HOST` | Workspace hosting the Genie Agent |
| `DBX_GENIE_SPACE_ID` | Internal API identifier for the configured Genie Agent |
| `VEEVA_SSO_ISSUER` | Exact issuer of the Veeva-provided Entra assertion |
| `VEEVA_SSO_AUDIENCE` | Expected token audience |
| `STATE_ENCRYPTION_SECRET` | Encrypts short-lived broker sessions |
| `ALLOWED_PARENT_ORIGINS` | Exact browser origins allowed to call the broker |
| `ALLOW_OPAQUE_PARENT_ORIGIN` | Enables native/file X-Page origins when required |

The broker also retains the earlier browser-session comparison routes. Their custom OAuth application settings are documented in `broker/.env.example`.

## Authentication and authorization

1. The X-Page requests an assertion from Veeva's native SSO bridge.
2. The broker verifies the assertion issuer, audience, identity claim, and expiration.
3. The broker exchanges it at the target Databricks workspace.
4. Databricks returns a token for the individual user.
5. Every Genie Agent API call uses that user's token.

Consequently, the following continue to apply:

- Workspace and Genie Agent access
- Unity Catalog grants
- Row filters and column masks
- SQL warehouse permissions
- Databricks audit attribution

This is not a shared-service-principal authorization model.

## Synthetic demonstration data

`ops/create_nsclc_genie_demo.sql` creates a disclosed synthetic cohort of 49,915 fictional Stage IV NSCLC patients in:

```text
af_vault_genie_demo.nsclc_rwe.gold_patient_master
```

The data contains no real patient records or PHI. It covers demographics, biomarkers, ECOG performance status, treatment, survival, and cost of care for demonstration purposes.

## Validation

Before deploying a release:

```bash
npm run lint
npm run package:xpage

cd broker
npm test
```

After deployment, verify:

1. The displayed identity matches the Veeva/Entra user.
2. A chat question returns prose, SQL, rows, and a visualization.
3. `View data` remains available alongside the chart.
4. Research mode either completes or reports that the workspace capability is unavailable.
5. Databricks audit events identify the individual user.
6. The same package works inside Vault CRM for iPad without opening Safari.

## Security notes

- Do not place Databricks tokens or client secrets in `public/xpage-config.js`.
- Restrict the broker to the intended Vault/X-Page origins.
- Keep the broker's Agent allowlist enabled.
- Use short-lived federation tokens and rotate the broker session secret.
- Grant users only the warehouse, Agent, catalog, schema, table, row, and column access they require.
- Use synthetic data for demos unless the full production privacy and compliance design has been approved.

## License

No license has been specified. Add one before redistributing the project outside the intended organization.
