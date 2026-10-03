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
iRep iPad client (MyInsights / X-Page)
  -> getSSOAccessToken() -> Ping Federate bearer token carrying mudid
  -> Kong gateway authenticates the token, forwards the Authorization header
  -> Broker reads the mudid claim (trusts Kong) and mints a Databricks OAuth
     M2M token carrying mudid as the custom claim
  -> Azure Databricks Genie Agent
  -> Claim-scoped view over the Unity Catalog synthetic NSCLC patient table
```

Databricks authorizes and audits the fixed service principal. A claim-scoped view limits each user to the treating sites their mudid is entitled to, so two users asking the same question see different rows. The individual user (mudid) is retained in the broker's structured compensating audit trail, not as the Databricks caller. Per-user Databricks grants, group membership, and native audit attribution do not apply; use the per-user federation implementation when those are requirements.

## Data

- Synthetic only; no real patient data or PHI.
- One denormalized row per patient.
- Demographics, stage, histology, smoking, biomarkers, PD-L1, ECOG, survival, treatment, and costs.
- Benchmark result must reproduce the visible source-space values for ECOG 0–3.

## Brand and interaction

Follow `PRODUCT.md` and `DESIGN.md`. The experience is intentionally close to Genie: white notebook canvas, coral spark, purple user bubble, text-first answers, flat chart surfaces, “Show code” disclosure, and a floating composer.

## Deployment targets

- Target workspace: `adb-7405615520098858.18.azuredatabricks.net`
- Genie Agent: `01f1bda165d9188a9d8121be0cc3a9b4`
- Service principal: `veeva-xpage-genie-shared`
- Broker: `af-vault-genie-sp-eus2-20260929.azurewebsites.net`
- X-Page content package: `artifacts/vault-crm-genie-service-principal-xpage.zip`
