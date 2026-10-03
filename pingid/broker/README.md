# Shared service-principal broker (Ping Federate / Kong variant)

This broker takes a Ping Federate bearer token forwarded by a Kong gateway, reads the end user's identity claim from it, and calls the configured Databricks Genie Agent with one fixed workspace service principal. Each Databricks token carries that identity claim, so claim-scoped views return only that user's rows.

It is a variant of the `service-principal/` broker. The only difference is the identity source: instead of verifying a Veeva Vault session, it trusts Kong to have authenticated the Ping token and reads the `mudid` claim from it.

## Trust model

Kong authenticates the Ping Federate bearer token — signature, issuer, audience, and expiry — and forwards it on the `Authorization` header. **The broker trusts that validation and does not re-verify the token.** It only decodes the payload and reads the configured identity claim (`IDENTITY_CLAIM_NAME`, default `mudid`). Deploy the broker so that only Kong can reach it.

## Identity model

```text
Ping Federate       -> bearer token carrying the mudid claim (validated by Kong)
Kong gateway        -> authenticates the token, forwards Authorization header
Identity claim      -> lowercase value of the IDENTITY_CLAIM_NAME claim (mudid)
Databricks OAuth M2M -> service-principal token minted with `custom_claim`
Genie API request   -> service-principal grants + claim-scoped rows
Conversation ticket -> conversation bound to the claim that started it
Structured app log  -> end user (mudid) + service principal + IDs
```

The broker refuses a session when the bearer token is missing, unreadable, or lacks the identity claim. It caches tokens per identity claim and uses a token only after confirming that Databricks echoed the exact claim back for this service principal.

Every user shares one service principal, so Genie itself would let any user read any conversation, including stored results computed under another user's claim. The broker therefore returns a signed `conversation_ticket` when a conversation starts (for Agent mode, as a `broker.conversation` stream event) and requires it in `X-Conversation-Ticket` on every follow-up call. A ticket only verifies for the same Genie Agent and identity claim.

Databricks audit events and query history identify the service principal; they never contain the identity claim. Structured `genie.audit` log entries provide the compensating attribution, including `chat.statements` entries that map Genie statement IDs to the end user's `mudid`, without logging prompts or query results.

## Run

```bash
cp .env.example .env
npm ci
npm test
npm start
```

Keep `DBX_SP_CLIENT_SECRET` and `STATE_ENCRYPTION_SECRET` in a secret manager or encrypted application settings. Never put either value in the X-Page package.

## Required Databricks permissions

The fixed service principal must be assigned to the workspace and have:

- Workspace access and Databricks SQL entitlement
- `CAN_RUN` on the Genie Agent
- `CAN_USE` on the Agent's SQL warehouse
- `USE CATALOG`, `USE SCHEMA`, and `SELECT` on the claim-scoped views exposed through the Agent, and no access to the underlying tables or entitlements

The claim-scoped view's `user_entitlements` table must be keyed on the `mudid` values that appear in the Ping tokens (not on Vault usernames or Federated IDs). The checked-in `.env.example` identifies the configured service principal and Agent but contains no secret.
