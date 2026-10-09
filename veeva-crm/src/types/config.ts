export type GenieExperienceMode = "chat" | "research";

export interface GenieMyInsightsConfig {
  workspaceHost: string;
  workspaceOrgId: string;
  genieAgentId: string;
  authBrokerBaseUrl: string;
  defaultMode?: GenieExperienceMode;
  displayName?: string;
  contextLabel?: string;
}

export interface ResolvedGenieMyInsightsConfig extends GenieMyInsightsConfig {
  defaultMode: GenieExperienceMode;
  displayName: string;
  contextLabel: string;
}

declare global {
  interface Window {
    __GENIE_MYINSIGHTS_CONFIG__?: GenieMyInsightsConfig;
  }
}

export {};
