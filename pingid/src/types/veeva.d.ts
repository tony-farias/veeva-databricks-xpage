interface VeevaSsoTokenResponse {
  success?: boolean;
  data?: { token?: string; statusCode?: number };
  message?: string;
}

// ds.request runs the HTTP call natively, outside the web view, so it is not
// subject to browser CORS. Header values must be strings, timeout is in
// seconds (default 30), and the body comes back as text.
interface VeevaRequestObject {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  expect?: "text" | "blob";
}

interface VeevaRequestResponse {
  success?: boolean;
  message?: string;
  data?: { statusCode?: number; body?: string };
}

interface VeevaDataService {
  doPostMessage?: (message: Record<string, unknown>) => Promise<unknown>;
  getSSOAccessToken?: (authIdentifier: string, providerName: string, oldToken: string | null) => Promise<unknown>;
  request?: (request: VeevaRequestObject) => Promise<unknown>;
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
