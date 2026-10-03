/*
 * Runtime-only configuration for the Vault CRM X-Page. This file contains no
 * secret. Update authBrokerBaseUrl after deploying the companion broker.
 */
window.__GENIE_XPAGE_CONFIG__ = Object.freeze({
  workspaceHost: "adb-7405615520098858.18.azuredatabricks.net",
  workspaceOrgId: "7405615520098858",
  genieAgentId: "01f1bda165d9188a9d8121be0cc3a9b4",
  authBrokerBaseUrl: "https://REPLACE-ME-ping-broker.azurewebsites.net",
  defaultMode: "chat",
  displayName: "NSCLC RWE · HEOR Cohort Explorer",
  contextLabel: "Synthetic clinical data · rows scoped to your identity (mudid)",
});
