# Shared service-principal broker

This broker silently authenticates the X-Page user with the active native Vault CRM session, then calls the configured Databricks Genie Agent with one fixed workspace service principal.

It is deliberately independent from the per-user federation broker at the repository root.

## Identity model

```text
Vault session ID      -> allowlisted Vault `/objects/users/me` verification
Databricks OAuth M2M -> fixed service-principal access token
Genie API request    -> service-principal authorization
Structured app log  -> Veeva user + service principal + conversation IDs
```

Databricks audit events identify the service principal. They do not identify the individual Veeva user. Structured `genie.audit` log entries provide the compensating application attribution without logging prompts or query results.

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
- `CAN_RUN` on the Genie Agent
- `CAN_USE` on the Agent's SQL warehouse
- `USE CATALOG`, `USE SCHEMA`, and `SELECT` on the curated data exposed through the Agent

The checked-in `.env.example` identifies the configured service principal and Agent but contains no secret.
