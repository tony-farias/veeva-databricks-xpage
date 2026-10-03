-- Created by ops/apply-claim-scoped-view.mjs with a claim-bearing token.
-- Callers without an identity claim fail with OAUTH_CUSTOM_IDENTITY_CLAIM_NOT_PROVIDED;
-- callers whose claim has no entitlement rows see no patients.
CREATE OR REPLACE VIEW af_vault_genie_demo.nsclc_rwe_scoped.gold_patient_master_scoped
COMMENT 'Synthetic advanced-NSCLC cohort limited to the treating sites entitled to the OAuth identity claim of the caller. Fails closed when no claim is present.'
AS
SELECT p.*, s.care_site_id
FROM af_vault_genie_demo.nsclc_rwe.gold_patient_master p
JOIN af_vault_genie_demo.nsclc_rwe_scoped.patient_care_site s
  ON p.person_id = s.person_id
WHERE s.care_site_id IN (
  SELECT e.care_site_id
  FROM af_vault_genie_demo.nsclc_rwe_scoped.user_entitlements e
  WHERE e.claim_key = current_oauth_custom_identity_claim()
)
