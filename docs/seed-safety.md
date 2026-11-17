# Destructive demo seed safety

`prisma/seed.ts` deletes existing business data and users before inserting demo fixtures. It is **not** a production bootstrap, backup, recovery, or migration tool.

The seed now fails closed before constructing a database client unless all of these hold:
- `NODE_ENV` is exactly `test` or `development` (production and unset are rejected).
- `APP_ENV`, when set, is only `test`, `dev`, `development`, or `local`; production/UAT/staging are rejected.
- `SEED_ALLOW_RESET` is exactly `RESET_DISPOSABLE_DATABASE`.
- `DATABASE_URL` is a PostgreSQL URL whose hostname is `localhost`, `127.0.0.1`, or `[::1]`.
- The unencoded database name ends in `_test` or `_e2e` and matches `SEED_DISPOSABLE_DATABASE` exactly.
- No URL fragment or connection query overrides are present. Only a single optional `schema=public` parameter is allowed.

## Disposable local database only

First create and independently verify a dedicated throwaway database. Never point this at an existing/shared database or tunnel/proxy forwarding to one. Naming and environment checks cannot prove that a database is disposable. Do not rename production, alter its environment, or tunnel it to bypass these checks. Do not keep confirmation variables in a shared `.env`.

For a verified throwaway `pr_management_e2e` database already selected by your local `DATABASE_URL`, scope confirmation to this command only:

```sh
NODE_ENV=test SEED_ALLOW_RESET=RESET_DISPOSABLE_DATABASE SEED_DISPOSABLE_DATABASE=pr_management_e2e npm run db:seed
```

This command **will erase that target's seeded tables**. No remote-host override is provided. Existing local setups with other database names must use a separate disposable test database instead of weakening the guard.

CI uses its existing isolated PostgreSQL service and sets the confirmations only on the seed and E2E steps (Playwright preparation also resets its disposable database). The production deployment workflow is unchanged and does not run the demo seed. `scripts/prepare-e2e.mjs` uses this same guard before its destructive `db push --accept-data-loss`, and additionally requires an `_e2e` name. Run local E2E with the same confirmations and `NODE_ENV=development`. Migrations remain separate and are not protected by this seed-specific check.

Run guard tests without a database:

```sh
node --import tsx --test tests/unit/seed-safety.test.ts
```
