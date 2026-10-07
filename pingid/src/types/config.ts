export type GenieExperienceMode = "chat" | "research";

export interface GenieXPageConfig {
  workspaceHost: string;
  workspaceOrgId: string;
  genieAgentId: string;
  authBrokerBaseUrl: string;
  // Arguments for ds.getSSOAccessToken. In the customer's MyInsights setup they
  // live in the Veeva Message AUTH_PROVIDER as "authIdentifier;;;providerName".
  ssoAuthIdentifier?: string;
  ssoProviderName?: string;
  defaultMode?: GenieExperienceMode;
  displayName?: string;
  contextLabel?: string;
}

export interface ResolvedGenieXPageConfig extends GenieXPageConfig {
  ssoAuthIdentifier: string;
  ssoProviderName: string;
  defaultMode: GenieExperienceMode;
  displayName: string;
  contextLabel: string;
}

declare global {
  interface Window {
    __GENIE_XPAGE_CONFIG__?: GenieXPageConfig;
  }
}

export {};
