interface VeevaDataService {
  doPostMessage?: (message: Record<string, unknown>) => Promise<unknown>;
  getSSOAccessToken?: (configurationName: string, providerName?: string, oldToken?: string) => Promise<unknown>;
  getVaultSessionId?: () => Promise<unknown>;
}

interface Window {
  ds?: VeevaDataService;
  Q?: unknown;
  webkit?: {
    messageHandlers?: {
      myInsightsAPI?: unknown;
    };
  };
}
