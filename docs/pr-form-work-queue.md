# Personal work queue and PR form UX

This change builds on the existing navy design. It does not replace menus, routes, fields, permissions, approval transitions, or database schemas.

## Changes
- Dashboard: personal drafts and returned requests; role-appropriate approval/purchasing groups; receiving follow-up. Every count and row is intersected with the existing visibility predicate. Up to five oldest-updated requests per group; use the existing PR list for the rest.
- Form: three numbered, focusable sections remain visible. Draft and send actions are distinct; send requires reviewing and confirming. Draft validation remains unchanged, not an incomplete-draft feature.
- Validation summary, explicit missing-price labels, partial-price subtotals, and unsaved-change indicator.
- Warn before ordinary link navigation and tab close/reload. Client-side Back/Forward and programmatic logout are not intercepted; this is not autosave.
- Existing attachment upload/removal and revision-comment behavior are retained.

## Safety and verification
No production access, seed, migrations, database writes, merge, or deployment are part of this delivery. CI database-backed E2E uses the existing disposable Postgres service. Queue unit tests mock Prisma and exercise visibility/role intersections and read-only behavior.

Browser QA used a temporary isolated form fixture with fictional data: validation summary/focus, review, cancellation preserving edits, desktop and 390px-wide layout. The fixture is removed from the shipped code. Real database workflows are verified by CI, not this preview.

Existing unit suites, typecheck, lint, production build and added E2E coverage are run/reported in the pull request. Product master aliases, inventory, partially valid drafts, approval redesign and autosave are outside this slice.
