const runtimeEnv = (import.meta as ImportMeta & {
  env?: { readonly VITE_API_BASE_URL?: string };
}).env;

const apiBaseUrl = (runtimeEnv?.VITE_API_BASE_URL?.trim() || "/api/v1").replace(/\/$/, "");

type AccessTokenRefresher = () => Promise<string | null>;

let accessTokenRefresher: AccessTokenRefresher | null = null;
let refreshInFlight: Promise<string | null> | null = null;
let lastRecoveredToken: { expiredToken: string; accessToken: string } | null = null;

export function configureApiAuthRecovery(refresher: AccessTokenRefresher | null): void {
  accessTokenRefresher = refresher;
  refreshInFlight = null;
  lastRecoveredToken = null;
}

async function recoverAccessToken(expiredToken: string): Promise<string | null> {
  if (lastRecoveredToken?.expiredToken === expiredToken) {
    return lastRecoveredToken.accessToken;
  }
  if (!accessTokenRefresher) return null;

  if (!refreshInFlight) {
    refreshInFlight = accessTokenRefresher()
      .catch(() => null)
      .finally(() => {
        refreshInFlight = null;
      });
  }

  const accessToken = await refreshInFlight;
  if (accessToken) lastRecoveredToken = { expiredToken, accessToken };
  return accessToken;
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
  };
}

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export async function apiRequest<T>(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  const send = (token: string) => fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  let response = await send(accessToken);
  if (response.status === 401) {
    const refreshedToken = await recoverAccessToken(accessToken);
    if (refreshedToken) response = await send(refreshedToken);
  }

  if (response.status === 204) return undefined as T;

  const responseText = await response.text();
  if (!responseText.trim()) {
    throw new ApiClientError(
      response.status || 503,
      "API_EMPTY_RESPONSE",
      "API 服务未返回数据，请确认本地 API 服务正在运行后重试。",
      true,
    );
  }

  let body: T | ApiErrorBody;
  try {
    body = JSON.parse(responseText) as T | ApiErrorBody;
  } catch {
    throw new ApiClientError(
      response.status || 502,
      "API_INVALID_RESPONSE",
      "API 服务返回了无法解析的数据，请稍后重试。",
      true,
    );
  }
  if (!response.ok) {
    const errorBody = body as ApiErrorBody;
    throw new ApiClientError(
      response.status,
      errorBody.error?.code ?? "UNKNOWN_ERROR",
      errorBody.error?.message ?? "请求失败。",
      errorBody.error?.retryable ?? false,
    );
  }
  return body as T;
}
