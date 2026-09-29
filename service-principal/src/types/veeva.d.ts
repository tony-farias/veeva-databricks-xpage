interface VeevaDataService {
  doPostMessage?: (message: Record<string, unknown>) => Promise<unknown>;
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
