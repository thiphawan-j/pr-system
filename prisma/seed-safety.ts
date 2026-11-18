/** Fail closed before the destructive demo seed constructs any database client. */
export function assertDisposableSeedTarget(env: Readonly<Record<string, string | undefined>>): string {
  const deny = (): never => {
    // Never include a connection URL, credentials, or supplied values in errors.
    throw new Error(
      "Destructive demo seed blocked. Use an isolated loopback PostgreSQL database ending in _test or _e2e, NODE_ENV=test/development, SEED_ALLOW_RESET=RESET_DISPOSABLE_DATABASE, and SEED_DISPOSABLE_DATABASE matching its exact name. See docs/seed-safety.md.",
    );
  };

  if (env.NODE_ENV !== "test" && env.NODE_ENV !== "development") deny();
  if (env.APP_ENV !== undefined && !["test", "dev", "development", "local"].includes(env.APP_ENV)) deny();
  if (env.SEED_ALLOW_RESET !== "RESET_DISPOSABLE_DATABASE") deny();
  if (!env.DATABASE_URL) deny();

  let url: URL;
  try { url = new URL(env.DATABASE_URL!); } catch { return deny(); }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") deny();
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) deny();
  if (url.hash) deny();

  // Do not permit libpq query parameters to redirect host/database/service or
  // inject options; our Prisma URL needs at most the public schema parameter.
  const params = [...url.searchParams.entries()];
  if (params.length > 1 || params.some(([key, value]) => key !== "schema" || value !== "public")) deny();

  // Strict unencoded path avoids ambiguous parsing between URL and pg drivers.
  const name = url.pathname.slice(1);
  if (!/^[a-z][a-z0-9_]*(?:_test|_e2e)$/.test(name) || name.length > 63) deny();
  if (env.SEED_DISPOSABLE_DATABASE !== name) deny();
  return env.DATABASE_URL!;
}
