# Product master and explicit aliases

Authenticated users can search `/products` and choose a product from a PR line. Only Purchasing/Admin can create canonical products or add aliases. The catalog is additive and intentionally does not offer rename, merge, delete, automatic matching, or historical backfill.

- Code identifies a distinct product; multiple contextual names can refer to that code.
- Different products may share an alias. Search returns candidates, never silently resolves ambiguity.
- Creating an alias requires checking the same-product confirmation; matching a PR line requires choosing a candidate and explicitly confirming its code, name and unit.
- PR text stays exactly as entered. The linked ID, code/name snapshots, confirmer and time are stored separately. Editing the PR name clears the UI link and requires reconfirmation. An unchanged linked line preserves its original snapshot and confirmer, including API clients omitting the optional linkage fields; explicit null unlinks it.
- No seed/import infers historical matches. Existing document lines stay null; catalog creation does not mutate them. Existing PR editing permissions and reapproval rules remain in force.
- A manufacturing output is not an alias for its input. Future inventory/production can reference the stable product ID and model lot/serial lineage separately. This PR does **not** implement stock balances, unit conversions, BOM, manufacturing, label printing, or PO-level snapshot propagation. PO retains its existing source-PR relationship and document text.

## Migration and rollout

`20261118100000_product_master` only creates catalog tables and adds nullable linkage columns/indexes/FK to PurchaseRequestItem. It does not UPDATE, DELETE, reseed, rename, or copy existing business data. Run normal reviewed deployment migrations before serving this application version; do not run demo seed in production. Take the normal verified backup first. Old application code ignores additive tables/columns, so app rollback does not require dropping catalog data. Never drop the migration objects after users start linking documents.

## Verification

- `npm run db:generate`, `npm run typecheck`, `npm run lint`, `npm run build`
- `node --conditions=react-server --import tsx --test tests/unit/product-master.test.ts`
- `npm run test:e2e -- product-master.spec.ts` only in the explicitly disposable, guarded E2E database described in seed-safety.md.
- CI runs full existing E2E plus catalog tests and deploys migrations to an isolated Postgres service. No production database verification is performed by this change.
