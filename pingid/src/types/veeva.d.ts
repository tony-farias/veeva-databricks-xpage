interface VeevaDataService {
  doPostMessage?: (message: Record<string, unknown>) => Promise<unknown>;
  getVaultSessionId?: () => Promise<unknown>;
  getSSOAccessToken?: () => Promise<unknown>;
}

interface Window {
  ds?: VeevaDataService;
  __PING_ACCESS_TOKEN__?: string;
  Q?: unknown;
  webkit?: {
    messageHandlers?: {
      myInsightsAPI?: unknown;
    };
  };
}
