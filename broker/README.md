# Vault CRM headless Genie broker

This service exchanges a Veeva-issued Entra user assertion for a user-scoped Databricks OAuth token, keeps that token inside an encrypted stateless session, and exposes only the Genie operations required by the X-Page.

## Headless routes

- `POST /api/session` — validate and exchange a Veeva assertion
- `GET /api/me` — inspect the broker session identity
- `POST /api/genie/chat/start`
- `POST /api/genie/chat/conversations/:conversationId/messages`
- `GET /api/genie/chat/conversations/:conversationId/messages/:messageId`
- `GET .../attachments/:attachmentId/query-result`
- `GET .../attachments/:attachmentId/visualization`
- `POST /api/genie/agent/responses` — SSE Agent-mode stream
- `GET /api/genie/agent/conversations/:conversationId/items`

The Genie Agent ID is fixed in server configuration. Arbitrary Databricks paths cannot be proxied.

## Security properties

- exact Veeva token issuer and audience checks before federation exchange
- Databricks validates the assertion signature through the account federation policy
- current-user lookup is required before a broker session is issued
- Databricks bearer tokens are AES-GCM encrypted and never returned to the X-Page
- sessions expire no later than the upstream tokens and are capped at one hour
- exact web-origin allowlist plus explicit native `null`-origin opt-in
- no token, request-body, or SQL logging
- signed query-result links and token-like response fields are removed
- rate limits and bounded request sizes

The legacy `/auth/start` and `/auth/callback` endpoints remain available for the earlier iframe comparison flow.
