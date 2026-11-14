# Navy workspace UI

This is the first implementation slice of the reviewed TangThong PR prototype, not a replacement of the application's workflows.

## Included

- Navy/light-gray-blue design tokens with coordinated dark mode.
- Persistent desktop sidebar, with the same eight destinations grouped into overview/requests, purchasing, and administration. Groups disappear when a role has no permitted links.
- The same navigation component in a scrollable left mobile drawer. Existing close-on-selection, Radix focus management and Escape behavior are retained.
- Existing notification, language, theme, profile and logout controls remain reachable in the header. The redundant header Create PR shortcut is removed; Create PR remains in navigation and on the dashboard.
- Keyboard skip-to-content link, visible focus and a print layout that hides application navigation.
- Thai and English group labels. Existing routes, longest-prefix selection and role filters remain intact.

## Deliberately unchanged

No schema, seed, migrations, API, access enforcement, approval rules, calculations, receipts, exports, sharing, or procurement workspace cutover changes. All existing page contents and data behavior remain. The prototype's product alias search, personal work queue and simplified form concepts are not implemented in this slice; they require separate data/workflow work and tests. No production deployment is part of this change.

## Verification

- `npm run build`, `npm run typecheck`, `npm run lint`
- `npm run test:button`, `npm run test:procurement-ownership`, `npm run test:po-document`, `npm run test:po-tax`
- UI inspection of actual AppShell components in an isolated local fixture: desktop and 390px mobile, both themes, translated navigation, drawer open/reopen/Close/Escape. The temporary fixture is not committed and does not read a database.
- Added `tests/e2e/workspace-navigation.spec.ts` for all admin routes, employee restrictions, longest-prefix active selection, back navigation, mobile dismiss/reopen/navigation and overflow. Existing E2E selectors now target the navigation landmark instead of its former header position.

Database-backed E2E must run in CI or a verified disposable test database, never production/shared data. The existing `e2e:prepare` resets and seeds its target database; inspect its configuration before running. No database was seeded or migrated during this UI implementation.
