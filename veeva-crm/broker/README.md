# Shared service-principal broker

This broker silently authenticates the MyInsights user with the active Veeva CRM (Salesforce) session, then calls the configured Databricks Genie Agent with one fixed workspace service principal. Each Databricks token carries an OAuth identity claim for the verified Salesforce user, so claim-scoped views return only that user's rows.

It is the Veeva CRM counterpart of the Vault CRM broker in [`service-principal/broker`](../../service-principal/broker). Only Veeva identity verification differs; the Databricks side is identical.

## Identity model

```text
Salesforce session ID -> allowlisted instance, SOAP getUserInfo(), org ID check
Identity claim        -> lowercase User.Username or User.FederationIdentifier
Databricks OAuth M2M -> service-principal token minted with `custom_claim`
Genie API request    -> service-principal grants + claim-scoped rows
Conversation ticket  -> conversation bound to the claim that started it
Structured app log  -> Veeva user + identity claim + service principal + IDs
```

The broker refuses a session when it belongs to an organization outside `SALESFORCE_ORG_IDS`, or when the configured Salesforce value is missing, empty, or not printable ASCII. It caches tokens per identity claim and uses a token only after confirming that Databricks echoed the exact claim back for this service principal.

Every MyInsights user shares one service principal, so Genie itself would let any user read any conversation, including stored results computed under another user's claim. The broker therefore returns a signed `conversation_ticket` when a conversation starts (for Agent mode, as a `broker.conversation` stream event) and requires it in `X-Conversation-Ticket` on every follow-up call. A ticket only verifies for the same Genie Agent and identity claim.

Databricks audit events and query history identify the service principal; they never contain the identity claim. Structured `genie.audit` log entries provide the compensating attribution, including `chat.statements` entries that map Genie statement IDs to the Veeva user, without logging prompts or query results.

## Run

```bash
cp .env.example .env
npm ci
npm test
npm start
```

Keep `DBX_SP_CLIENT_SECRET` and `STATE_ENCRYPTION_SECRET` in a secret manager or encrypted application settings. Never put either value in the MyInsights package. Restrict `SALESFORCE_ALLOWED_ORIGINS` to the exact instance origins that `getSFDCSessionID()` returns for the customer org; this prevents the user-supplied instance URL from becoming an SSRF target. `SALESFORCE_ORG_IDS` then pins sessions to the customer's org, which matters when an instance hostname is shared.

## Why SOAP `getUserInfo()`

`getSFDCSessionID()` returns a Salesforce UI session ID, not an OAuth access token from a connected app. Salesforce's OAuth `userinfo` endpoint can reject those sessions, while SOAP `getUserInfo()` accepts any API-enabled session and returns the session's own user and organization. When `IDENTITY_CLAIM_SOURCE=federation_id`, the broker then reads `FederationIdentifier` from that user's record with the REST API. Users therefore need the **API Enabled** permission, which Veeva CRM users normally already have for iPad sync.

## Required Databricks permissions

The fixed service principal must be assigned to the workspace and have:

- Workspace access and Databricks SQL entitlement
- `CAN_RUN` on the Genie Agent
- `CAN_USE` on the Agent's SQL warehouse
- `USE CATALOG`, `USE SCHEMA`, and `SELECT` on the claim-scoped views exposed through the Agent, and no access to the underlying tables or entitlements

The checked-in `.env.example` identifies the configured service principal and Agent but contains no secret.
