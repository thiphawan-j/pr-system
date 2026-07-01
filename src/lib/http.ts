type ApiFetchOptions = RequestInit & {
  body?: unknown;
};

export class ApiClientError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ApiClientError";
    this.statusCode = statusCode;
  }
}

export async function apiFetch<T>(
  input: RequestInfo | URL,
  options: ApiFetchOptions = {},
): Promise<T> {
  const response = await fetch(input, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    body:
      options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiClientError(
      payload?.error ?? "เกิดข้อผิดพลาดในการเชื่อมต่อระบบ",
      response.status,
    );
  }

  return payload as T;
}
