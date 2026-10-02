-- Row scoping for the shared service-principal Genie broker.
--
-- The broker mints every Databricks token with an OAuth identity claim derived
-- from the verified Vault user. A view filters rows by matching that claim,
-- through current_oauth_custom_identity_claim(), against an entitlement table.
--
-- Run this script as a catalog administrator. It cannot create the claim-scoped
-- view itself: Databricks evaluates current_oauth_custom_identity_claim() while
-- creating any object that references it and fails without a claim. Create the
-- view afterwards with ops/apply-claim-scoped-view.mjs.

CREATE SCHEMA IF NOT EXISTS af_vault_genie_demo.nsclc_rwe_scoped
COMMENT 'Synthetic advanced-NSCLC cohort scoped per Veeva user through the OAuth identity claim of the shared service principal';

CREATE OR REPLACE TABLE af_vault_genie_demo.nsclc_rwe_scoped.user_entitlements (
  claim_key STRING NOT NULL COMMENT 'Canonical identity claim: the lowercase Vault username or Federated ID, matching the broker IDENTITY_CLAIM_SOURCE',
  care_site_id STRING NOT NULL COMMENT 'Treating site whose patients this user may see'
)
COMMENT 'Identity claim to treating-site entitlements. In production, sync this from Vault CRM user and account alignment.';

-- Databricks accepts an empty claim and the broker canonicalizes to lowercase;
-- keep entitlement keys in that same form so no row can match an unexpected claim.
ALTER TABLE af_vault_genie_demo.nsclc_rwe_scoped.user_entitlements
ADD CONSTRAINT canonical_claim_key CHECK (claim_key <> '' AND claim_key = lower(trim(claim_key)));

-- The demo user is keyed both ways so the demo works with either
-- IDENTITY_CLAIM_SOURCE: federated_id__sys and user_name__v. The fictional
-- second persona sees different sites, for side-by-side comparison.
INSERT INTO af_vault_genie_demo.nsclc_rwe_scoped.user_entitlements VALUES
  ('antonio.farias@databricks.com', 'SITE-0001'),
  ('tf@vvtechpartner-databricks.com', 'SITE-0001'),
  ('demo.msl.west@example.com', 'SITE-0002'),
  ('demo.msl.west@example.com', 'SITE-0003');

-- About 4,000 fictional treating sites of roughly a dozen patients each.
CREATE OR REPLACE TABLE af_vault_genie_demo.nsclc_rwe_scoped.patient_care_site
COMMENT 'Synthetic treating-site assignment for each fictional patient; the row-scoping dimension'
AS
SELECT
  person_id,
  concat('SITE-', lpad(CAST(pmod(person_id, 4000) + 1 AS STRING), 4, '0')) AS care_site_id
FROM af_vault_genie_demo.nsclc_rwe.gold_patient_master;

-- The runtime service principal reaches the data only through the scoped view.
-- ops/apply-claim-scoped-view.mjs grants SELECT on that view; it receives no
-- access to the entitlement or site tables.
GRANT USE CATALOG ON CATALOG af_vault_genie_demo TO `7cf9fe9b-c14f-4b9f-8fcf-a094f0421c7b`;
GRANT USE SCHEMA ON SCHEMA af_vault_genie_demo.nsclc_rwe_scoped TO `7cf9fe9b-c14f-4b9f-8fcf-a094f0421c7b`;
