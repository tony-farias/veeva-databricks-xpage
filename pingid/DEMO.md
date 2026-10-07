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
  -> ds.getSSOAccessToken(authIdentifier, providerName, oldToken)
     -> Ping Federate bearer token; its `sub` claim identifies the user
  -> ds.request(): every broker call goes to the Kong route with
     Authorization: Bearer <Ping token>
  -> Kong gateway validates the token on every call and forwards it
  -> Broker reads `sub` from the forwarded token on every call (trusts Kong)
     and mints a Databricks OAuth M2M token carrying it as the custom claim
  -> Azure Databricks Genie Agent
  -> Claim-scoped view over the Unity Catalog synthetic NSCLC patient table
```

Databricks authorizes and audits the fixed service principal. A claim-scoped view limits each user to the treating sites their `sub` value is entitled to, so two users asking the same question see different rows. The individual user (`sub`) is retained in the broker's structured compensating audit trail, not as the Databricks caller. Per-user Databricks grants, group membership, and native audit attribution do not apply; use the per-user federation implementation when those are requirements.

## Data

- Synthetic only; no real patient data or PHI.
- One denormalized row per patient.
- Demographics, stage, histology, smoking, biomarkers, PD-L1, ECOG, survival, treatment, and costs.
- Benchmark result must reproduce the visible source-space values for ECOG 0–3.

## Brand and interaction

Follow `PRODUCT.md` and `DESIGN.md`. The experience is intentionally close to Genie: white notebook canvas, coral spark, purple user bubble, text-first answers, flat chart surfaces, “Show code” disclosure, and a floating composer.

## Deployment targets

- Target workspace: `adb-7405608383447105.5.azuredatabricks.net`
- Genie Agent: `01f1c1bc36b518d7b7a59b21c1bd3b92`
- Service principal: `veeva-xpage-genie-shared`
- Broker: not deployed; reached only through a Kong route (`authBrokerBaseUrl`)
- X-Page content package: built with `npm run package:xpage`
