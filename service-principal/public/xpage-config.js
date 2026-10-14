/*
 * Runtime-only configuration for the Vault CRM X-Page. This file contains no
 * secret. Update authBrokerBaseUrl after deploying the companion broker. The
 * broker decides which Genie Agents each Veeva user may open.
 */
window.__GENIE_XPAGE_CONFIG__ = Object.freeze({
  workspaceHost: "adb-7405608383447105.5.azuredatabricks.net",
  workspaceOrgId: "7405608383447105",
  authBrokerBaseUrl: "https://af-vault-genie-sp-eus2-20260929.azurewebsites.net",
  defaultMode: "chat",
});
