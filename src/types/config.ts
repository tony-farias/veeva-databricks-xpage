export type GenieExperienceMode = "chat" | "research";

export interface GenieXPageConfig {
  workspaceHost: string;
  workspaceOrgId: string;
  genieAgentId: string;
  authBrokerBaseUrl: string;
  ssoConfigurationName?: string;
  defaultMode?: GenieExperienceMode;
  displayName?: string;
  contextLabel?: string;
}

export interface ResolvedGenieXPageConfig extends GenieXPageConfig {
  ssoConfigurationName: string;
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
