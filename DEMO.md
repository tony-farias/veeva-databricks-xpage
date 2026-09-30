# NSCLC RWE Clinical Genie X-Page

## Goal

Embed a headless, per-user Databricks Genie experience in Veeva Vault CRM for iPad. The demo uses disclosed synthetic advanced-NSCLC real-world-evidence data and visually follows the Databricks Genie UI.

## Use cases

1. Compare patient count and median observed overall survival by ECOG performance status.
2. Explore survival, cost of care, treatment patterns, biomarker status, and demographics.
3. Review generated SQL, governed tabular results, and Genie-generated visualizations.
4. Run deeper Agent/Research analysis when supported by the target workspace.

## Architecture

```text
Vault CRM X-Page (React/TypeScript)
  -> native Vault session + signed Okta/Entra user assertion
  -> Azure broker (Vault verification, three-way identity binding, allowlisted Genie routes)
  -> Databricks account-wide OAuth federation exchange for the individual user
  -> Azure Databricks Genie Space
  -> Unity Catalog synthetic NSCLC patient table
```

## Data

- Synthetic only; no real patient data or PHI.
- One denormalized row per patient.
- Demographics, stage, histology, smoking, biomarkers, PD-L1, ECOG, survival, treatment, and costs.
- Benchmark result must reproduce the visible source-space values for ECOG 0–3.

## Brand and interaction

Follow `PRODUCT.md` and `DESIGN.md`. The experience is intentionally close to Genie: white notebook canvas, coral spark, purple user bubble, text-first answers, flat chart surfaces, “Show code” disclosure, and a floating composer.

## Deployment targets

- Source inspection: `fe-vm-hls-amer.cloud.databricks.com`
- Target workspace: `adb-7405615520098858.18.azuredatabricks.net`
- Federated-user broker: `af-vault-genie-userfed-eus2.azurewebsites.net`
- X-Page content package: `artifacts/vault-crm-genie-xpage.zip`
