# Deploy the Genie broker into an existing Azure Function App

Use this guide for the **Ping/Kong X-Page** in `pingid/`. The remaining work is to deploy the broker into the customer's existing Function App, connect its Kong route, and set the X-Page's broker base URL.

## What the Function App does

A Function App is the Azure service that runs the backend code. The **broker** is the code we deploy into it. It receives requests from the X-Page through Kong, calls Databricks Genie, and sends the answers back. It keeps the Databricks secret out of the X-Page.

```text
Veeva X-Page → Kong (checks Ping sign-in) → Function App (broker) → Databricks Genie
```

The broker reads the signed-in user's Ping `sub` value and passes it to Databricks as the identity claim. Kong validates the Ping token on **every** `/api/*` request. The Function App must accept application traffic only from Kong, because the broker relies on Kong's token validation.

## Which folder and ZIP to use

| Item | Location | Destination |
| --- | --- | --- |
| Function App source, configuration and build | `pingid/function-app/` | Customer backend source repository or build pipeline |
| Azure deployment ZIP | `pingid/function-app/artifacts/broker-functions.zip` | Existing Azure Function App |
| X-Page configuration | `pingid/public/xpage-config.js` | Set the Kong base URL before rebuilding |
| Veeva content ZIP | `pingid/artifacts/vault-crm-genie-service-principal-xpage.zip` | Veeva HTML Report |

The old `pingid/broker/` path now contains a pointer to `pingid/function-app/`.

## 1. Check the existing Function App

Ask its Azure owner to record the app name, subscription, resource group, hostname, hosting plan and existing deployment pipeline. Keep the current release and settings available for rollback.

Use **Node.js 22**, **Functions runtime 4** (4.28 or newer for HTTP streaming), and the **Node.js v4 programming model**. Keep the app's existing host storage, networking, identity and monitoring configuration.

Decide how its code will be updated:

- **The existing app will run only this broker:** deploy the ZIP built in step 3. Its `host.json` uses an empty HTTP route prefix, so its URLs are `/health` and `/api/...`.
- **The app must keep other functions:** follow [Add the broker alongside existing functions](#add-the-broker-alongside-existing-functions). Deploy the combined application through the existing pipeline. A broker-only ZIP replaces app content and could remove those other functions.

An existing Python/.NET app cannot run this Node package alongside its current code in the same Function App. An existing Node v3 programming-model app needs a coordinated migration: v3 and v4 functions cannot be mixed. Have the app owner resolve that compatibility before deployment.

## 2. Add the application settings

In Azure Portal, open the existing Function App → **Settings → Environment variables** (called **Configuration → Application settings** in some portal views). Add the values below. Preserve unrelated settings. Save the changes; Azure restarts the app.

Use `app-settings.example.json` as the checklist. It contains placeholders and Key Vault reference examples, not credentials.

| Setting | Value |
| --- | --- |
| `FUNCTIONS_WORKER_RUNTIME` | `node` |
| `FUNCTIONS_EXTENSION_VERSION` | `~4`, where this setting applies to the existing hosting plan |
| `DBX_WORKSPACE_HOST` | Customer Databricks hostname, without `https://` or a path |
| `DBX_GENIE_AGENT_ID` | The Genie space ID approved for this X-Page |
| `DBX_SP_CLIENT_ID` | Databricks service principal application ID |
| `DBX_SP_CLIENT_SECRET` | Key Vault reference to its **Databricks OAuth secret** |
| `DBX_SP_OAUTH_SCOPE` | `genie` for the agreed Chat pilot |
| `DBX_SP_DISPLAY_NAME` | A descriptive service principal name |
| `IDENTITY_CLAIM_NAME` | `sub`, the Ping claim containing the user's MUD ID |
| `STATE_ENCRYPTION_SECRET` | Key Vault reference to a random secret of at least 32 bytes; keep it identical across app instances |
| `BROKER_FUNCTION_AUTH_LEVEL` | `function`; Kong supplies the Function key |
| `BROKER_FUNCTION_ROUTE_PREFIX` | Empty for a broker-only app; `veeva-genie` for the shared-app example below |
| `ALLOWED_PARENT_ORIGINS` | Exact HTTPS origin used for browser testing, such as the Kong origin |
| `ALLOW_OPAQUE_PARENT_ORIGIN` | `false`; set `true` only if the tested native caller actually sends `Origin: null` |
| `ALLOW_VEEVA_PARENT_ORIGINS` | `false` |

Keep the existing `AzureWebJobsStorage` configuration. Enable the Function App's managed identity to read the two Key Vault secrets and confirm that both references resolve. The Function key is a separate gateway-to-Azure credential; it does not replace the Databricks OAuth secret. No secret or Function key belongs in `xpage-config.js`.

Before continuing, the service principal should already have workspace/SQL access, **Can run** on the X-Page's Genie space, **Can use** on its warehouse, and the necessary Unity Catalog grants. For the initial connectivity test, use only pilot data that every tester may see. Claim-scoped views and removal of direct base-table access are required before accepting per-user row isolation.

## 3. Build the Function App package

In this checkout, from the repository root:

```bash
cd pingid/function-app
npm ci
npm test
npm run package:functions
```

Deploy this output:

```text
pingid/function-app/artifacts/broker-functions.zip
```

It contains `host.json`, `package.json`, compiled `dist/` code and production `node_modules/` at the ZIP root. It excludes local settings, secrets, source tests and the X-Page. It is a prebuilt package; an additional remote TypeScript build is unnecessary.

## 4. Deploy to the existing app

Use the customer's existing release pipeline if one is already in place. Supply the ZIP from step 3, or the combined app release for a shared Function App.

For an existing **Consumption, Premium or Dedicated app that uses ZIP deployment**, the Azure owner can run:

```bash
az login
az account set --subscription <customer-subscription-id>
az functionapp deployment source config-zip \
  --resource-group <existing-resource-group> \
  --name <existing-function-app-name> \
  --src artifacts/broker-functions.zip \
  --build-remote false
```

Run the deployment command from `pingid/function-app/`. **Flex Consumption uses package deployment/OneDeploy rather than this ZIP-deploy API.** For Flex, use the existing pipeline's Azure Functions deployment task/action with Flex support. For an ad hoc deployment, Azure Functions Core Tools v4 can publish the prebuilt package directory:

```bash
# Extract the ZIP into a new, empty temporary directory.
unzip artifacts/broker-functions.zip -d <empty-temporary-directory>
cd <empty-temporary-directory>
func azure functionapp publish <existing-function-app-name> --no-build
```

Core Tools selects the app's supported deployment mechanism. Deploy from a machine or runner with access to the app's deployment endpoint if it is private.

In Azure Portal, confirm the host starts and the **`veevaGenieBroker`** function appears. Check Application Insights/Log stream for startup or missing-setting errors. Do not configure `node dist/server.js` as a Function App startup command; the Azure Functions host loads the function through `package.json`.

## 5. Connect Kong to the function

Have the Kong owner:

1. Route the X-Page's `/api/*` requests to the Function App, preserving the rest of each path and its query string. For a broker-only app the upstream path is `/api/...`. For a shared app, use its agreed mount path as described below.
2. Validate the Ping token's signature, issuer, audience and expiry on every request.
3. Forward `Authorization` and `X-Conversation-Ticket` unchanged.
4. Obtain a key for `veevaGenieBroker` and add it to upstream requests as **`x-functions-key`**. Store it in the gateway's secret configuration.
5. Allow the gateway's network path into the Function App and block direct application traffic from other callers.
6. Allow at least 300 seconds for the upstream read timeout if Research is in the pilot. Preserve streaming responses. The native bridge can wait for the complete result.

Native `ds.request` calls do not require browser CORS configuration. The broker's origin settings are still relevant for browser-based tests.

## 6. Test the backend

Through the permitted network path, call `/health` with the Function key supplied by the gateway. Expect HTTP 200:

```json
{"ok":true,"authorizationMode":"service_principal","dataScope":"identity_claim"}
```

Health only proves the function is running. Then open the existing X-Page and test the complete path:

1. Ping sign-in succeeds through the native bridge and Kong accepts the token.
2. `POST /api/session` succeeds and reports the correct user and service principal.
3. A simple Chat question returns an answer from the intended Genie space.
4. Follow-up questions and chart downloads work.
5. An invalid/expired Ping token is rejected by Kong. A direct request bypassing Kong is blocked.

If testing row isolation, compare two users with different entitlements after the scoped views are configured. Merely forwarding `sub` does not filter an unscoped table.

Test Research separately if required. Azure HTTP front ends impose request-duration limits (Microsoft documents a 230-second HTTP-trigger limit), and a 300-second Kong timeout or streaming setting does not guarantee a long Research request will complete.

## 7. Finish the X-Page configuration

In `pingid/public/xpage-config.js`, set **`authBrokerBaseUrl` to the Kong base URL** that fronts the deployed broker. For example, if the gateway exposes `https://gateway.example.com/genie/api/session`, the base URL is `https://gateway.example.com/genie`.

The X-Page appends `/api/...`; do not append that API path again. Keep its workspace and Genie space IDs aligned with the Function App settings.

If the uploaded X-Page already has this exact base URL, it does not need a rebuild. Otherwise, from `pingid/`, run `npm ci` and `npm run package:xpage`, upload `artifacts/vault-crm-genie-service-principal-xpage.zip` to the existing HTML Report, then sync and reopen it on the device.

## Add the broker alongside existing functions

Use this only when the existing Function App already uses Node.js v4 and must preserve other functions:

1. Copy this folder's `src/` into a dedicated namespace in the existing project, for example `src/veeva-genie/`. Preserve its relative imports.
2. Add the dependencies from this folder's `package.json` to the existing project and update its lockfile.
3. Load `./veeva-genie/functions/broker.js` from the existing TypeScript entry module, or include the resulting compiled function file in the existing `package.json` `main` glob. Keep its existing function registrations loaded too.
4. Keep the existing `host.json`. Enable HTTP streaming with `app.setup({ enableHttpStream: true })` during startup, as the broker adapter does. Do not replace a shared app's HTTP prefix, extension bundle or other global settings with the broker-only template.
5. Set `BROKER_FUNCTION_ROUTE_PREFIX=veeva-genie`. With the common existing host prefix `api`, the broker's upstream URLs become `/api/veeva-genie/health` and `/api/veeva-genie/api/session`. The adapter strips the hosting prefix before forwarding to the broker. Have Kong prepend `/api/veeva-genie` to the broker's `/api/...` paths.
6. Build and deploy the **whole combined app** using its existing pipeline. Check both the existing functions and the new broker before releasing.

Record the deployed revision/ZIP checksum, Function App and Kong routes, settings owner and test results. Roll back with the previous app release and its matching configuration; restore the previous X-Page only if its base URL changed.

## References

- [Azure Functions Node.js developer guide](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node)
- [Azure Functions deployment methods](https://learn.microsoft.com/en-us/azure/azure-functions/functions-deployment-technologies)
- [ZIP deployment](https://learn.microsoft.com/en-us/azure/azure-functions/deployment-zip-push)
- [Azure Functions HTTP trigger limits](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-http-webhook-trigger#limits)
