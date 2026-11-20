---
name: enargo-action-plan-review
description: Use when asked where a client stands in Enargo: what money is owed back or could be saved, what is due, which findings and alerts are open, or to record progress on an action.
---

# Review a client's action plan, findings and alerts

Read `enargo-mcp` first. Everything here is a read except `update_action`,
`acknowledge_monitoring_alert` and `refresh_monitoring_alerts`, which need the user's
explicit yes.

## 1. Start with the plan

Call `list_actions` `{brief: true}`. The plan is built afresh on every read from findings, claims,
refund sheets, capacity advisories, savings checks, compliance steps and monitoring alerts. One
action is one thing to do. The fields that matter:

- `key`: what `update_action` takes, for example `findings:open` or `deadline:bics:…`.
- `category`: recover, save, protect or comply.
- `whose`: `you` means the client's move, `enargo` means ours.
- `valueGbp`, `valueBasis` and `certainty`: the basis is one-off or a-year, and the certainty is
  proven, estimate or to-confirm.
- `dueOn` and `daysLeft`.
- `status`, `ownerName`, `note` and `steps`.

Filters (`whose`, `status`, `dueWithinDays`) narrow the actions but never the summary.

**Quote the `headline`.** For example: "11 open action(s), 7 waiting on the client. £126,693
confirmed as owed back; up to about £150,292 a year in estimated savings, not yet confirmed. Next
deadline: … (11 days)." (illustrative figures) Never add the confirmed, claimed and estimated figures
together, and never present an estimate as money owed.

## 2. Go under the actions that matter

| To answer | Read |
|---|---|
| What was billed wrong | `list_findings` `{state: "open"}`, largest first. Each has `reference` (invoice and line), `errorClass`, `componentKey`, period and `magnitude`. |
| Claims and recoveries | `list_claims` |
| Credits the supplier owes | `list_refund_position`, `list_refund_reconciliation`, `list_account_balance_check` |
| What is changing or overdue | `list_monitoring_alerts` (open alerts with severity, money at stake and due date, plus the deadline calendar) |
| Capacity, residual band, relief and waste savings | `list_residual_band_checks`, `list_relief_opportunities`, `list_consumption_shapes`, `list_uncontracted_supplies`, `list_gas_aq_checks`, `list_gas_soq_checks` |
| Scheme packs | `read_bics_application_pack`, `read_ncc_claim_pack`, `list_compliance_packs` |
| Spend and carbon | `list_cost_trend`, `list_budget_position`, `list_carbon_position` |
| Whether the checks can see enough | `list_consumption_coverage`, `list_contracts`, `read_tax_position` |

Before calling a finding real, sanity-check it against its cause, using the lessons in
`enargo-bill-load-and-check` step 7. Watch for a relief not yet recorded, a reissued bill priced
twice, a contract not matched, or a bogus meter reading. A large cluster of findings of one class
on one meter is usually one cause.

## 3. Record progress (with a yes)

`update_action` `{actionKey, status?, ownerName?, note?, snoozedUntil?}`:

- `in-progress` when someone has started.
- `done` only when the step has actually finished. For money, that means when it has arrived.
  Say what happened in the note. Marking done never counts as money received.
- `snoozed` takes `snoozedUntil`, within a year.
- `dismissed` requires a note giving the reason. It closes the action only. The findings behind
  it stay open, because MCP cannot dismiss findings.
- An action whose condition clears closes by itself. A done action reopens if new meters join it.

`acknowledge_monitoring_alert` `{alertId, note}` records what is being done about an alert. The
alert stays open while its condition holds. `refresh_monitoring_alerts` runs every watch now,
instead of waiting for 06:55. `preview_monitoring_digest` shows this week's digest and sends
nothing. Adding digest recipients is operator-only, and adding a client or external recipient
needs the user's yes.

## 4. Report

Keep it short and in this order:

1. The headline, quoted.
2. What needs the client this week, with deadlines.
3. The largest confirmed recoveries, with their invoice numbers.
4. Estimated savings, labelled as estimates, with what would confirm them.
5. What the checks can't see yet, and why.

When something is the client's move, say exactly what they need to send or decide.
