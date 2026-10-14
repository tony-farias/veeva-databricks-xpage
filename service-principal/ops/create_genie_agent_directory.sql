-- Which Genie Agents each Veeva user may open, granted by Veeva role.
--
-- user_roles maps the canonical identity claim (the same value the broker puts
-- on every Databricks token) to Veeva roles; in production, sync it from Vault
-- CRM group membership. role_agents names the Genie Agents each role includes
-- and is maintained on the Databricks side. The broker reads neither table: it
-- reads my_genie_agents, a claim-scoped view that returns only the caller's
-- Agents. Create that view afterwards with:
--
--   node ops/apply-claim-scoped-view.mjs ops/genie_agent_directory_view.sql
--
-- The Genie space title and description label each Agent in the X-Page, so
-- these tables hold IDs only. Run this script as a catalog administrator.

CREATE SCHEMA IF NOT EXISTS af_vault_genie_demo.genie_access
COMMENT 'Veeva role to Genie Agent entitlements for the shared service-principal X-Page';

CREATE OR REPLACE TABLE af_vault_genie_demo.genie_access.user_roles (
  claim_key STRING NOT NULL COMMENT 'Canonical identity claim: the lowercase Vault username or Federated ID, matching the broker IDENTITY_CLAIM_SOURCE',
  role STRING NOT NULL COMMENT 'Veeva role, such as a Vault CRM group'
)
COMMENT 'Identity claim to Veeva role. In production, sync this from Vault CRM group membership.';

-- Keep keys in the broker's canonical form so no row can match an unexpected claim.
ALTER TABLE af_vault_genie_demo.genie_access.user_roles
ADD CONSTRAINT canonical_claim_key CHECK (claim_key <> '' AND claim_key = lower(trim(claim_key)));

CREATE OR REPLACE TABLE af_vault_genie_demo.genie_access.role_agents (
  role STRING NOT NULL COMMENT 'Veeva role, matching user_roles.role',
  agent_id STRING NOT NULL COMMENT 'Genie space ID of an Agent this role includes'
)
COMMENT 'Genie Agents that each Veeva role includes';

-- The demo user is keyed both ways so the demo works with either
-- IDENTITY_CLAIM_SOURCE, and holds two roles so the X-Page offers a choice.
-- The fictional second persona holds one role and opens its Agent directly.
INSERT INTO af_vault_genie_demo.genie_access.user_roles VALUES
  ('antonio.farias@databricks.com', 'heor_analyst'),
  ('antonio.farias@databricks.com', 'field_medical'),
  ('tf@vvtechpartner-databricks.com', 'heor_analyst'),
  ('tf@vvtechpartner-databricks.com', 'field_medical'),
  ('demo.msl.west@example.com', 'field_medical');

INSERT INTO af_vault_genie_demo.genie_access.role_agents VALUES
  ('heor_analyst', '01f1c1bc36b518d7b7a59b21c1bd3b92'),
  ('field_medical', '01f1c81534111e01b8b3957dbc9cc314');

-- The runtime service principal reaches the directory only through the view.
-- ops/apply-claim-scoped-view.mjs grants SELECT on it; the service principal
-- receives no access to user_roles or role_agents.
GRANT USE SCHEMA ON SCHEMA af_vault_genie_demo.genie_access TO `6d18456b-9dba-4ca9-9e65-d2843df4dd7a`;
