# Federated-user Genie broker

This service implements Databricks **account-wide OAuth token federation** for a Veeva Vault CRM X-Page. It exchanges the signed user JWT returned by Veeva's configured IdP for a short-lived Databricks OAuth token representing that same user, then proxies only the allowlisted Genie Agent APIs.

It does not use a Databricks OAuth client ID or client secret. Those belong to the old browser authorization-code flow and are intentionally absent here.

## Identity flow

```text
Native Vault session -> allowlisted Vault /objects/users/me -> Vault username
Veeva SSO JWT        -> issuer/audience/claim precheck     -> IdP username
                     -> Databricks /oidc/v1/token          -> user OAuth token
                     -> Databricks SCIM /Me                -> Databricks username

Require Vault username == IdP username == Databricks username
                     -> encrypted 15-minute broker session
                     -> allowlisted Genie Agent APIs
```

Username comparison trims whitespace and is case-insensitive. It does not rewrite domains, normalize aliases, or use an application-maintained identity map. The IdP claim selected by `VEEVA_SSO_USERNAME_CLAIM` must therefore contain the user's Databricks username.

## Account federation policy

The Databricks account must trust the same issuer, audience, and username claim configured on the broker. For example:

```bash
databricks account federation-policy create --profile <account-admin-profile> --json '{
  "oidc_policy": {
    "issuer": "https://company.okta.com/oauth2/<authorization-server-id>",
    "audiences": ["<jwt-audience>"],
    "subject_claim": "email"
  }
}'
```

Use account-wide federation—not a service-principal federation policy—because the desired Databricks caller is the individual user. The user must already exist in the Databricks account/workspace, normally through SCIM, and must have access to the Agent, warehouse, and governed data.

Only register an account-wide issuer controlled and trusted by the organization. Databricks validates the JWT signature and policy match during the exchange; the broker's local claim parsing is only a defensive precheck.

## Headless routes

- `POST /api/session` — validate the Vault session, exchange the user JWT, and bind all three identities
- `GET /api/me` — inspect the bound session identities
- `POST /api/genie/chat/start`
- `POST /api/genie/chat/conversations/:conversationId/messages`
- `GET /api/genie/chat/conversations/:conversationId/messages/:messageId`
- `GET .../attachments/:attachmentId/query-result`
- `GET .../attachments/:attachmentId/visualization`
- `POST /api/genie/agent/responses` — SSE Agent-mode stream
- `GET /api/genie/agent/conversations/:conversationId/items`

The Agent ID is fixed in server configuration. Arbitrary Databricks paths cannot be proxied.

## Run

```bash
cp .env.example .env
npm ci
npm test
npm start
```

Keep `STATE_ENCRYPTION_SECRET` in a secret manager or encrypted application setting. Restrict `VEEVA_VAULT_ALLOWED_ORIGINS` to exact Vault origins; this prevents the client-supplied Vault URL from becoming an SSRF target.

## Security properties

- native Vault session is validated directly against an allowlisted Vault instance
- only RS256 or ES256 external JWTs with the configured issuer, audience, username claim, and lifetime are submitted for exchange
- Databricks validates the external JWT signature through its account federation policy
- Vault, external-token, and Databricks usernames must match before a session is issued
- Databricks bearer tokens are AES-GCM encrypted and never returned to the X-Page
- sessions expire no later than either upstream token and are capped at 15 minutes by default
- exact web-origin allowlist plus explicit native/hosted-Veeva opt-ins
- no token, prompt, request body, SQL, or result logging
- structured audit correlation identifies the Vault, federated, and Databricks users
- signed result links and token-like response fields are removed
- request size limits, route allowlisting, and rate limits
