const runtimeEnv = (import.meta as ImportMeta & {
  env?: { readonly VITE_API_BASE_URL?: string };
}).env;

const apiBaseUrl = (runtimeEnv?.VITE_API_BASE_URL?.trim() || "/api/v1").replace(/\/$/, "");

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
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
      Authorization: `Bearer ${accessToken}`,
    },
  });

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
