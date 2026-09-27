import type { GenieXPageConfig, ResolvedGenieXPageConfig } from "../types/config";

const defaults: ResolvedGenieXPageConfig = {
  workspaceHost: "",
  workspaceOrgId: "",
  genieAgentId: "",
  authBrokerBaseUrl: "",
  ssoConfigurationName: "databricks_genie_user_federation__c",
  defaultMode: "chat",
  displayName: "NSCLC RWE — HEOR Cohort Explorer",
  contextLabel: "Synthetic clinical data · governed by Unity Catalog",
};

export function getConfig(): ResolvedGenieXPageConfig {
  const supplied: Partial<GenieXPageConfig> = window.__GENIE_XPAGE_CONFIG__ ?? {};
  return {
    ...defaults,
    ...supplied,
    workspaceHost: normalizeHost(supplied.workspaceHost ?? defaults.workspaceHost),
    authBrokerBaseUrl: (supplied.authBrokerBaseUrl ?? "").replace(/\/$/, ""),
  };
}

export function configProblems(config: ResolvedGenieXPageConfig): string[] {
  const problems: string[] = [];
  if (!config.workspaceHost) problems.push("workspaceHost is missing");
  if (!config.workspaceOrgId) problems.push("workspaceOrgId is missing");
  if (!config.genieAgentId) problems.push("genieAgentId is missing");
  if (!config.ssoConfigurationName) problems.push("ssoConfigurationName is missing");
  if (!isUsableBrokerUrl(config.authBrokerBaseUrl)) {
    problems.push("authBrokerBaseUrl is missing or still contains REPLACE-ME");
  }
  return problems;
}

export function genieWorkspaceUrl(config: ResolvedGenieXPageConfig): string {
  const query = new URLSearchParams({ o: config.workspaceOrgId });
  return `https://${config.workspaceHost}/genie/rooms/${encodeURIComponent(config.genieAgentId)}?${query}`;
}

function normalizeHost(value: string): string {
  return value.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function isUsableBrokerUrl(value: string): boolean {
  if (!value || /replace-me/i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  } catch {
    return false;
  }
}
