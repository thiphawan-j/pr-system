export const LOGIN_RETURN_PATH_HEADER = "x-pr-login-return-path";

export function getPurchaseRequestReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 512) return null;
  const prefix = "/purchase-requests/";
  if (!value.startsWith(prefix)) return null;
  const id = value.slice(prefix.length);
  // Accept only a canonical PR detail path. No schemes, separators, encoding,
  // query strings or fragments from the untrusted login query are forwarded.
  if (!id || id === "new" || /[^A-Za-z0-9_-]/.test(id)) return null;
  return value;
}

export function getLoginDestination(value: unknown): string {
  return getPurchaseRequestReturnPath(value) ?? "/dashboard";
}

export function getLoginPath(value: unknown): string {
  const returnPath = getPurchaseRequestReturnPath(value);
  return returnPath ? `/login?${new URLSearchParams({ next: returnPath })}` : "/login";
}
