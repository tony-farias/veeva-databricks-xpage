export type GenieExperienceMode = "chat" | "research";

// The Genie Agents are not configured here: the broker lists the ones the
// signed-in Veeva user may open.
export interface GenieXPageConfig {
  workspaceHost: string;
  workspaceOrgId: string;
  authBrokerBaseUrl: string;
  defaultMode?: GenieExperienceMode;
}

export interface ResolvedGenieXPageConfig extends GenieXPageConfig {
  defaultMode: GenieExperienceMode;
}

declare global {
  interface Window {
    __GENIE_XPAGE_CONFIG__?: GenieXPageConfig;
  }
}

export {};
