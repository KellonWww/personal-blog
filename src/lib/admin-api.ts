export class AdminRequestError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) {
    super(message);
    this.name = 'AdminRequestError';
  }
}

/** All admin requests retain cookie auth and surface server validation errors. */
export async function adminRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  const response = await fetch(url, { ...options, headers });
  const payload = await response.json().catch(() => null) as { data?: T; message?: string; code?: string } | null;
  if (response.status === 401) {
    window.location.assign('/admin/login');
    throw new Error('登录已过期，请重新登录');
  }
  if (!response.ok || !payload || payload.data === undefined) {
    throw new AdminRequestError(payload?.message || `请求失败（${response.status}）`, response.status, payload?.code ?? 'REQUEST_FAILED');
  }
  return payload.data;
}

export function adminWrite(token: string, method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
    body: body === undefined ? undefined : JSON.stringify(body)
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请稍后重试';
}
