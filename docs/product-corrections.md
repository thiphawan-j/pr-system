# Safe catalog corrections (stacked on PR #8)

Depends on the product master migration and UI in PR #8. Merge/review the master first; this change is additive and must be migrated before the new app runs. Do not seed production.

Purchasing/Admin can:
- Correct the canonical **name only**, with a mandatory reason and explicit same-product UI confirmation. Code, ID and unit cannot be rewritten. A different identity/unit requires a new product record.
- Deactivate an incorrect product or alias, retaining its identity, history and existing document links. There is no delete/reparent/merge/reactivate path. A disabled alias cannot be re-added with identical product/name/context; create a genuinely corrected alias or use a separate reviewed restoration feature in future.
- Add a new explicitly confirmed alias. Alias changes also advance the parent's version.
- Inspect paginated audit records: actor ID and name snapshot, timestamp, reason, before/after values. Historical creation records are not fabricated; corrections and new aliases are audited from this release onward.
- View inactive products using the status filter. Ordinary employees/approvers cannot access inactive lists or audit actor data. Managers see inactive aliases; search matching and PR selector suggestions exclude them.

## Historical documents

PR text, saved code/name snapshots, confirmer and confirmation time are never rewritten by catalog corrections. The PR detail may show the **current inactive state separately**, without replacing historical names. Unchanged linked PR lines retain their snapshots when edited, even if their master is inactive. Changing a line's name clears the form's link; a new link requires fresh search and explicit confirmation. Existing PR permissions/reapproval rules still apply.

## Concurrency

All catalog mutations and newly confirmed PR links lock Product rows in deterministic ID order (`SELECT ... FOR UPDATE`) within their write transactions. Corrections require the version the operator saw. Fresh PR selections send `productVersion`; stale or missing versions are rejected with 409 and must be searched/confirmed again. No catalog-to-document refresh occurs automatically. Existing unmodified linked items do not require re-confirming historical identity.

A link which commits before deactivation/rename keeps its confirmed snapshot. A correction which wins first prevents a stale link from being committed. Renaming during a dialog cannot silently substitute a different name in the saved document.

## Deployment and verification

Migration `20261118110000_product_corrections` adds Product.version, ProductAlias.isActive and ProductAudit. It does not update/delete PR or PO data. Take/verify a backup and use the normal migration deployment. Keep additive tables/columns if rolling application code back.

Run lint/typecheck/build and unit product-master/product-corrections tests. E2E coverage includes authorization, immutable fields, optimistic races, selection-vs-rename races, unchanged document snapshots, alias replacement, and mobile cancel/confirm/history/deactivation flows. Database tests run only in isolated disposable CI PostgreSQL, not production.
