import type { GenieXPageConfig, ResolvedGenieXPageConfig } from "../types/config";
import { hasInjectedAccessToken } from "./pingToken";

const defaults: ResolvedGenieXPageConfig = {
  workspaceHost: "",
  workspaceOrgId: "",
  genieAgentId: "",
  authBrokerBaseUrl: "",
  ssoAuthIdentifier: "",
  ssoProviderName: "",
  defaultMode: "chat",
  displayName: "NSCLC RWE · HEOR Cohort Explorer",
  contextLabel: "Synthetic clinical data · rows scoped to your Ping identity (sub)",
};

export function getConfig(): ResolvedGenieXPageConfig {
  const supplied: Partial<GenieXPageConfig> = window.__GENIE_XPAGE_CONFIG__ ?? {};
  return {
    ...defaults,
    ...supplied,
    workspaceHost: normalizeHost(supplied.workspaceHost ?? defaults.workspaceHost),
    authBrokerBaseUrl: (supplied.authBrokerBaseUrl ?? "").replace(/\/$/, ""),
    ssoAuthIdentifier: (supplied.ssoAuthIdentifier ?? "").trim(),
    ssoProviderName: (supplied.ssoProviderName ?? "").trim(),
  };
}

export function configProblems(config: ResolvedGenieXPageConfig): string[] {
  const problems: string[] = [];
  if (!config.workspaceHost) problems.push("workspaceHost is missing");
  if (!config.workspaceOrgId) problems.push("workspaceOrgId is missing");
  if (!config.genieAgentId) problems.push("genieAgentId is missing");
  if (!isUsableBrokerUrl(config.authBrokerBaseUrl)) {
    problems.push("authBrokerBaseUrl is missing or still contains REPLACE-ME");
  }
  // A token injected for local testing does not need the SSO bridge.
  if (!hasInjectedAccessToken()) {
    if (!isConfigured(config.ssoAuthIdentifier)) problems.push("ssoAuthIdentifier is missing or still contains REPLACE-ME");
    if (!isConfigured(config.ssoProviderName)) problems.push("ssoProviderName is missing or still contains REPLACE-ME");
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

function isConfigured(value: string): boolean {
  return Boolean(value) && !/replace-me/i.test(value);
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
