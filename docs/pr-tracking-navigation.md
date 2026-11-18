# Tracking, work-queue pages, and form document boundaries

## Read-only tracking
PR detail now has a four-part overview of request, approval, PO, and receipt/completion records. It links to the existing detail/history sections and authorized PO pages. Cancelled, rejected, returned, partially ordered, pending PO change, and receipt-reference-pending states have distinct guidance. Dates are recorded history, not evidence that an old approval remains current. No state transition, access check, document total, or receipt quantity is changed. Receipt/closed-remainder records are distinguished; unlike units are never summed.

## Personal work queue
Each role-visible group has independent URL-backed previous/next pages of five entries, ordered by updated timestamp and ID. Both counts and rows intersect the existing visibility predicate. Malformed/duplicate page values reset to one; excessive and stale pages clamp to the current visible count. Concurrent updates can move rows between pages; this is not a frozen snapshot.

## Unsaved form navigation
All known new/edit PR entry links use document navigation. While a PR form is mounted, normal outgoing HTTP links also navigate as documents. Successful saves replace the form document with the saved detail page. These boundaries let the browser's native beforeunload warning cover Back/Forward, reload, closing a tab, and normal outgoing navigation without synthetic history entries or racing Next's router. Cancelling preserves form values and selected files in the current document.

Tradeoff: entering/leaving a form does a full page load. Native warning wording is browser-controlled and requires user interaction. Forced app termination/mobile OS process killing is not reliably warnable. This is not autosave or recovery after confirmed navigation. Programmatic logout remains outside this warning guarantee. Future entry links must preserve this document-boundary convention.

## Verification and safety
Unit coverage checks role/visibility pagination and tracking semantics; E2E covers queue pages, tracking anchors/mobile, and interrupted/repeated form navigation. CI uses its confirmed disposable database. No production DB access, schema change, seed, merge, or deployment is part of this delivery. Separate product-master/aliases and backup work is outside this PR.
