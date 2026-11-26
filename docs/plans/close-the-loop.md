# Plan: Close the loop

Carry a diagnosis to a verified repair, inside the project plan's product boundary: no maintenance
scheduling or prediction, no commands to equipment, no generated instructions, no user accounts.

| Slice | Features | Status |
|-------|----------|--------|
| A | Data-quality report, models page (`GET /api/v1/models`) | **Built**, ADR 0027 |
| B | Work orders, fix verification, handoff export (CSV) | Proposed, after Phase 8 |
| C | Measured energy impact, field accuracy | Proposed, after Phase 8 |

Slice A closes two items on the README's own MVP list. Slices B and C are extensions: README
section 19 asks that extensions wait until the core workflow is validated, which is Phase 8's job.
Each needs its own ADR before code.

## Slice B (proposed)

- **Work orders.**
  - A person opens a work order from one or more fault events on one unit.
  - It freezes the model's answer, the evidence, and the fault library's checks word for word, with
    their source ids and the library version.
  - States: open, in progress, completed (needs an outcome and findings) and cancelled (needs a
    reason).
  - Moves go through `POST /work-orders/{id}/transitions`. Every change is written to an
    append-only `work_order_log` in the same transaction.
  - Concurrent edits are caught with PostgreSQL `xmin` as the EF Core concurrency token
    (`If-Match`, `412`).
  - The outcome is a human-confirmed label, stored apart from the model result, which never
    changes.
- **Suggested priority.**
  - High: a named fault of 24 h or more, or a measured energy excess.
  - Medium: any other named fault.
  - Low: no named fault.
  - Urgent is set only by a person. The suggestion and its reason are stored beside the person's
    choice.
- **Fix verification.** The repair time is entered as recorded in the unit's data. The first
  succeeded analysis whose data starts after it decides:
  - verified: at least 24 scored hours and no event naming the fault,
  - still present: an event names the fault,
  - not yet verifiable: fewer than 24 scored hours.
- **Handoff export.** A CSV with the list's filters and a print-friendly order page. No
  maintenance-system integration until someone asks for one.

## Slice C (proposed)

- **Measured energy impact.**
  - Calculated only where the normal model predicts compressor power, which today means simulated
    format with all points: excess kWh = Σ (observed − expected) × 1 h ÷ 1000 over steady event
    hours.
  - Shown only when it is outside the 5th to 95th percentile of the same sum over fault-free
    validation windows of equal length.
  - Cost is shown only with a configured price per kWh. Everywhere else it says "Not estimated".
- **Field accuracy.**
  - Per fault: confirmed versus a different fault or no fault, from closed work orders.
  - Shown as counts, with a percentage only from 10 orders, beside the held-out precision.
  - It always shows its selection-bias caveat and never retrains automatically.

The design, with diagrams and an interactive walkthrough, is in the FaultIQ Platform Guide.
