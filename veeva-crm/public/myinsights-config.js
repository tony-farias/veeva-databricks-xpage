/*
 * Runtime-only configuration for the Veeva CRM MyInsights page. This file contains no
 * secret. Update authBrokerBaseUrl after deploying the companion broker.
 */
window.__GENIE_MYINSIGHTS_CONFIG__ = Object.freeze({
  workspaceHost: "adb-7405608383447105.5.azuredatabricks.net",
  workspaceOrgId: "7405608383447105",
  genieAgentId: "01f1c1bc36b518d7b7a59b21c1bd3b92",
  authBrokerBaseUrl: "https://REPLACE-ME-veeva-crm-genie-broker.azurewebsites.net",
  defaultMode: "chat",
  displayName: "NSCLC RWE · HEOR Cohort Explorer",
  contextLabel: "Synthetic clinical data · rows scoped to your Veeva identity",
});
