# 0028. Work orders, fix verification and handoff export (Close the loop, slice B)

- **Status:** Accepted
- **Date:** 2026-11-27
- **Plan:** [docs/plans/close-the-loop.md](../plans/close-the-loop.md)
- **Builds on:** ADR 0013, 0023, 0024, 0025, 0026, 0027

## Context

A diagnosis ended at a review verdict. Nobody could hand a case to a technician, record what was
found on site, or see whether the repair worked. The project plan asks for a confirmed outcome to
be recorded and kept apart from the model's prediction (section 3, step 8; architecture rule 5).

The Close the loop plan put slice B after Phase 8, because README section 19 asks extensions to wait
for a validated core workflow. The owner chose to build it now, before Phase 8. Phase 8 stays next,
and its backlog is unchanged.

The product boundary still holds:
- no maintenance scheduling or prediction,
- no commands to equipment,
- no generated instructions,
- no user accounts.

## Decision

**Data model** (EF Core, three tables):
- `work_orders`:
  - a display number from an identity column (`WO-0007`),
  - the unit, the fault (null when the events name none), a title,
  - status and priority, with the suggested priority and its reason,
  - assignee and notes,
  - the checks copied from the fault library with their source ids, plus the library version and
    review status,
  - outcome, confirmed fault, findings, repair time and cancel reason,
  - timestamps.
- `work_order_events`: links an order to one or more events of the same unit.
- `work_order_log`: append-only. Each request writes one row in the same transaction (an edit of
  priority and assignee together is one entry), ordered by an identity column because rows saved
  in quick succession can share a timestamp.

PostgreSQL's `xmin` is the EF Core concurrency token.

**Creating an order.**
- A person opens it from events of one unit, all naming the same fault or all naming none.
- Events that are `not_diagnosable` cannot start an order.
- An event can be on at most one open order. The event rows are locked
  (`SELECT … FOR UPDATE`) while this is checked, so two people can't both claim the same event.
- Checks are copied word for word from the library. Nothing is generated.

**Suggested priority** (a person can always change it):
- High: a named fault on an event of 24 hours or more. In Phase 5, long events were the reliable
  ones: 80% right by count, but 97% by hours.
- Medium: any other named fault.
- Low: no named fault.
- Urgent is never suggested.

**States.**
- `open` → `in_progress` → `completed`, and `open` or `in_progress` → `cancelled`.
- Moves go through `POST /work-orders/{id}/transitions`, checked by one table in C#:
  - Completing needs findings and an outcome: `confirmed`, `different_fault` (with the fault
    found) or `no_fault_found`.
  - A repair time is needed unless no fault was found.
  - Cancelling needs a reason.
- Invalid moves return `409 invalid_transition`.
- Every write needs `If-Match` with the order's version:
  - a stale version returns `412 stale_work_order`,
  - a missing one returns `428 precondition_required`.
- Completing never changes the stored model result or the events' review status. The outcome is
  the order's own human label.

**Fix verification** is computed when an order is read, never stored. The repair time is entered
as recorded in the unit's data, because data times have no zone (ADR 0025). The first succeeded
analysis of the same unit whose data starts at or after it decides:
- `verified`: at least 24 scored hours, and no event naming the fault,
- `persists`: an event names the fault,
- `not_verifiable`: fewer scored hours.

Before such an analysis exists the state is `pending`. Orders completed as `no_fault_found` are
`not_applicable`.

**Handoff export.**
- `GET /work-orders/export` returns a CSV with the list's filters.
- Cells starting with `=`, `+`, `-` or `@` are prefixed with `'`, so a spreadsheet won't run them
  as formulas.
- The order page prints cleanly.

**Names are typed text.** Assignee and "recorded by" are labelled as unverified identities.

## Consequences

- Three tables, six endpoints, two screens and a panel on each unit view. No new services or
  packages (ADR 0013).
- An order for an inconclusive event has no checks. The technician uses the event's alternatives
  and the library.
- Verification depends on someone uploading data from after the repair. Until then the order says
  `pending`.
- The 24-hour thresholds for priority and verification are starting values, to be checked on fresh
  data along with the minimum event length in the Phase 8 backlog.
- Field accuracy (slice C) can read human outcomes from `work_orders` without changing this schema.
