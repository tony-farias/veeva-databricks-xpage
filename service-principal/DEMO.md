# NSCLC RWE Clinical Genie X-Page

## Goal

Embed a headless Databricks Genie Agent experience in Veeva Vault CRM for iPad using one fixed workspace service principal. The demo uses disclosed synthetic advanced-NSCLC real-world-evidence data and visually follows the Databricks Genie UI.

## Use cases

1. Compare patient count and median observed overall survival by ECOG performance status.
2. Explore survival, cost of care, treatment patterns, biomarker status, and demographics.
3. Review generated SQL, governed tabular results, and Genie-generated visualizations.
4. Run deeper Agent/Research analysis when supported by the target workspace.

## Architecture

```text
Vault CRM X-Page (React/TypeScript)
  -> Native Vault session (silent on iPad/iPhone)
  -> Azure broker validates the session with Vault `/objects/users/me`
  -> Databricks OAuth M2M token for the fixed service principal
  -> Azure Databricks Genie Agent
  -> Unity Catalog synthetic NSCLC patient table
```

Databricks authorizes and audits the fixed service principal. The individual Veeva user is retained in the broker's structured compensating audit trail, not as the Databricks caller. This option is for customers who want one curated shared data boundary; it does not preserve per-user Databricks grants or row-level security.

## Data

- Synthetic only; no real patient data or PHI.
- One denormalized row per patient.
- Demographics, stage, histology, smoking, biomarkers, PD-L1, ECOG, survival, treatment, and costs.
- Benchmark result must reproduce the visible source-space values for ECOG 0–3.

## Brand and interaction

Follow `PRODUCT.md` and `DESIGN.md`. The experience is intentionally close to Genie: white notebook canvas, coral spark, purple user bubble, text-first answers, flat chart surfaces, “Show code” disclosure, and a floating composer.

## Deployment targets

- Target workspace: `adb-7405615520098858.18.azuredatabricks.net`
- Genie Agent: `01f1b959138b1575a09b54923fa27532`
- Service principal: `veeva-xpage-genie-shared`
- Broker: `af-vault-genie-sp-eus2-20260929.azurewebsites.net`
- X-Page content package: `artifacts/vault-crm-genie-service-principal-xpage.zip`
