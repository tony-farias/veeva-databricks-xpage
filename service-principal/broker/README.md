# Shared service-principal broker

This broker silently authenticates the X-Page user with the active native Vault CRM session, then calls Databricks Genie Agents with one fixed workspace service principal. Each Databricks token carries an OAuth identity claim for the verified Vault user. A claim-scoped directory view decides which Agents the user may open, and claim-scoped data views return only that user's rows.

It is deliberately independent from the per-user federation broker at the repository root.

## Identity model

```text
Vault session ID      -> allowlisted Vault `/objects/users/me` verification
Identity claim        -> lowercase user_name__v or federated_id__sys
Databricks OAuth M2M -> service-principal token minted with `custom_claim`
Agent directory      -> Genie Agent IDs from the claim-scoped directory view
Genie API request    -> an Agent from the sealed list + claim-scoped rows
Conversation ticket  -> conversation bound to the Agent and claim that started it
Structured app log  -> Veeva user + identity claim + service principal + IDs
```

The broker refuses a session when the configured Vault value is missing, empty, or not printable ASCII. It caches tokens per identity claim and uses a token only after confirming that Databricks echoed the exact claim back for this service principal.

Every X-Page user shares one service principal, so Genie itself would let any user read any conversation, including stored results computed under another user's claim. The broker therefore returns a signed `conversation_ticket` when a conversation starts (for Agent mode, as a `broker.conversation` stream event) and requires it in `X-Conversation-Ticket` on every follow-up call. A ticket only verifies for the same Genie Agent and identity claim.

`POST /api/session` returns the Agents the user may open, each with its Genie space title and description, and seals their IDs into the encrypted session. Genie routes are scoped by Agent: `/api/agents/{agentId}/chat/...` and `/api/agents/{agentId}/research/...`. A request for an Agent that is not in the session fails with HTTP 403 `agent_not_entitled` and a `security.agent_rejected` log entry. Set `GENIE_AGENT_DIRECTORY_VIEW` and `DBX_WAREHOUSE_ID` to list Agents by Veeva role, or `DBX_GENIE_AGENT_ID` to offer one Agent to every user.

Databricks audit events and query history identify the service principal; they never contain the identity claim. Structured `genie.audit` log entries provide the compensating attribution, including `chat.statements` entries that map Genie statement IDs to the Veeva user, without logging prompts or query results.

## Run

```bash
cp .env.example .env
npm ci
npm test
npm start
```

Keep `DBX_SP_CLIENT_SECRET` and `STATE_ENCRYPTION_SECRET` in a secret manager or encrypted application settings. Never put either value in the X-Page package. Restrict `VEEVA_VAULT_ALLOWED_ORIGINS` to the exact customer Vault origins; this prevents the user-supplied Vault URL from becoming an SSRF target.

## Required Databricks permissions

The fixed service principal must be assigned to the workspace and have:

- Workspace access and Databricks SQL entitlement
- `CAN_RUN` on every Genie Agent the directory can return; the broker leaves out Agents it cannot open
- `CAN_USE` on the SQL warehouse of each Agent and on `DBX_WAREHOUSE_ID`
- `USE CATALOG`, `USE SCHEMA`, and `SELECT` on the claim-scoped views exposed through the Agents and on the directory view, and no access to the underlying tables, entitlements, or role tables

The checked-in `.env.example` identifies the configured service principal and directory view but contains no secret.
