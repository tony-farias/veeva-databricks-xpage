/*
 * Runtime-only configuration for the X-Page. This file contains no secret.
 *
 * authBrokerBaseUrl is the Kong route that fronts the broker (not the broker's
 * own host): every call carries the Ping bearer token and Kong validates it.
 *
 * ssoAuthIdentifier / ssoProviderName are the arguments passed to the Veeva
 * bridge ds.getSSOAccessToken(). They are the two halves of the Veeva Message
 * AUTH_PROVIDER value, "authIdentifier;;;providerName".
 */
window.__GENIE_XPAGE_CONFIG__ = Object.freeze({
  workspaceHost: "adb-7405608383447105.5.azuredatabricks.net",
  workspaceOrgId: "7405608383447105",
  genieAgentId: "01f1c1bc36b518d7b7a59b21c1bd3b92",
  authBrokerBaseUrl: "https://REPLACE-ME-kong-route.example.com/genie-broker",
  ssoAuthIdentifier: "REPLACE-ME-sso-provider-developer-name",
  ssoProviderName: "REPLACE-ME-provider-name",
  defaultMode: "chat",
  displayName: "NSCLC RWE · HEOR Cohort Explorer",
  contextLabel: "Synthetic clinical data · rows scoped to your Ping identity (sub)",
});
