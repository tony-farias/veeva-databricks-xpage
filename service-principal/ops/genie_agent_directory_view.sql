-- Created by ops/apply-claim-scoped-view.mjs with a claim-bearing token.
-- The broker reads this view at sign-in to list the caller's Genie Agents.
-- Callers without an identity claim fail with OAUTH_CUSTOM_IDENTITY_CLAIM_NOT_PROVIDED;
-- callers whose claim has no roles see no Agents.
CREATE OR REPLACE VIEW af_vault_genie_demo.genie_access.my_genie_agents
COMMENT 'Genie Agents included in the Veeva roles of the caller, matched on the OAuth identity claim. Fails closed when no claim is present.'
AS
SELECT DISTINCT ra.agent_id
FROM af_vault_genie_demo.genie_access.role_agents ra
JOIN af_vault_genie_demo.genie_access.user_roles ur
  ON ur.role = ra.role
WHERE ur.claim_key = current_oauth_custom_identity_claim()
