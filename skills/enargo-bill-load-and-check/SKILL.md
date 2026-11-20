---
name: enargo-bill-load-and-check
description: Use when a client sends supplier bills or credit notes (PDFs) to load into Enargo and check against HH data, the contract, reliefs and network charges, ending with findings to raise or clear.
---

# Load a batch of bills into Enargo and check them

Read `enargo-mcp` first for connecting, roles and the approval rule. This routine comes from
loading several years of one meter's bills and credit notes in one batch. Most of the traps below
came up on real loads.

## 0. Before uploading: read the batch

Work out what the batch is before touching the client's data:

- **Which meter and account.** Read the MPAN, supplier account and site from each PDF
  (`pdftotext -layout`). Check them against `list_meter_points` and `list_invoices`. One client
  can have several supplier accounts with the same site name, so match on the account number, not
  the name.
- **Invoices versus credits.** Suppliers often issue a credit note (for example `CRnnnn`) that cancels the
  invoice with the same number (`INnnnn`), and a replacement invoice follows with a new number. Pair them up and count the live
  bills that are left, month by month, so a missing month stands out.
- **What the bills say about reliefs.** Look for a CCL line at or near zero and a "PP11" or
  "Climate Change Levy exemption" statement, with its share and dates. Also check the VAT rate.
- Note the maximum demand and capacity (kVA) each bill prints. You will need them in step 6.

Then ask for the yes. Name the count, the client and the meter.

## 1. Upload

Call `upload_invoice` once per PDF:

```json
{"filename": "<supplier>-<account>-<invoice number>.pdf", "contentType": "application/pdf", "contentBase64": "<base64>"}
```

It accepts PDF only. Use a filename that carries the account and the invoice number, so holds can
be traced. The reply only says the file was stored. Reading happens afterwards.

## 2. Watch it read

Call `list_documents`, newest first, and page through it. Each document has a `stage` (`read`,
`held` or `queued`), `holds` (each with a reason and detail) and `invoices` (rows produced). Wait
and re-check; don't loop. Holds seen so far:

| Hold | Meaning and what to do |
|---|---|
| lines do not sum | The reader's lines don't add up to the total. It is usually a reader miss on a long bill. Report it with the invoice number. It needs a reader fix, so don't re-upload. |
| unreadable (output token limit) | The PDF is too long for one read. It needs a reader change or an operator re-run. |
| 429 / retrying | The model was rate limited. It retries by itself. |
| no meter point | The bill names an MPAN the estate doesn't hold, or the reader missed it. Check `list_meter_points`. If the meter really is missing, `add_meter_point` (with a yes) releases held bills. |
| duplicate logical key | The bill matches one already held. Older deployments keyed this on supplier, account, period and total, so a reissue with the same total collapsed onto the cancelled original and the month netted to zero. Check whether it is a true duplicate or a reissue, and report a reissue held this way. |

Expect some reads to lag. Report how many have read, what is held and why, and what is queued.

## 3. Check volume against half-hourly data

Call `list_consumption_coverage` to confirm the meter's HH data covers the billed months, with
nothing missing and nothing estimated. Then compare billed kWh with HH kWh month by month. Usually
nearly every month matches exactly. A month a few percent out is worth naming with its kWh.
The engine's `billed-volume-not-supported-by-settled-consumption` findings do this per line.

## 4. Match the contract

Call `list_contracts` and compare its `supplier` and account with what the bills were read as (in
`list_invoices`). A calculation finds a contract by **exact** supplier and account. Bills read under
a trading brand never match a contract filed under the parent company's name.

- Wrong supplier name: use `restate_contract_supplier` `{contractId, supplier, accountReference?}`
  with the bills' own wording. Leave `accountReference` empty for a contract-level price.
- The bills carry an account that no contract names: a contract whose terms list the
  meter (`contract_term` scoped `mpan=`) is matched by meter instead.
- A contract whose parsed terms still await confirmation prices nothing. See
  `enargo-client-onboarding` step 4.
- After a change, `reprice_contract` `{contractId}` re-sends every covered invoice. Remember the
  24-hour replay: a second identical call does nothing. Count how many bills are now priced against
  the contract.

Each confirmation, restatement and reprice is a write, so it needs the yes.

## 5. Record reliefs before trusting levy findings

If the bills show CCL relieved and no relief is on file, every CCL line can raise a false finding.
On a multi-year load that can be dozens of findings worth hundreds of thousands of pounds.

1. Call `read_tax_position` to see what is on file and whether the position is confirmed.
2. Call `record_tax_relief` with the certificate's own terms (needs a yes):

   ```json
   {"kind": "ccl-exemption", "reference": "PP11 <site>", "validFrom": "2022-04-01",
    "validTo": "2030-04-01", "sharePercent": 95, "meterPoint": "<13-digit MPAN core>",
    "basis": "mineralogical process", "note": "Stated on the supplier's bills"}
   ```

   `validTo` is the first day it no longer applies. Kinds are `vat-qualifying-use`, `cca`,
   `ccl-exemption`, `domestic` and `charity-non-business`.
3. The VAT and CCL checks run only after `confirm_tax_position` `{note}`. Confirm only when the
   client has said these are all their reliefs, not just the ones you found.
4. Bills are re-checked within the hour. The volume check leaves a relieved CCL line out, and the
   CCL check tests it instead.

## 6. Check network charges

- `list_network_charge_check` returns the expected DUoS and TNUoS cost per meter, and every bill
  line naming a published EDCM or TNUoS residual rate, checked against it.
- Where no expected cost is filed, use the EnergyCode calls. Some APIs refuse
  datacentre traffic, so you may need to run them from the user's own machine. File each reply whole with
  `file_network_rate_card` or `file_network_charge_calculation` `{meter, sourceLabel, response}`.
  EnergyCode's `/calculate` fails before April 2024. For those periods, use
  `price_network_charges_from_published_rates` `{meter, periodStart, periodEnd, dryRun: true}`
  first, then without `dryRun` once it looks right (that run is a write).
- Read the capacity lines by hand too. Compare each bill's printed maximum demand with the HH peak
  for that month. A bill that prints a maximum demand ten times the connection, while the HH peak
  that month is normal, is a meter or data error. One such reading can cost tens of thousands of
  pounds in excess capacity charges.
- BSUoS, Triad and policy levies on Flex bills are inside the pass-through lines and can't be
  checked without the supplier's breakdown. Say so rather than calling them correct.

## 7. Findings: raise, explain, clear

Call `list_findings` `{state: "open"}`. It is largest first and paged. For each new finding, read
its `errorClass`, `componentKey`, period and `magnitude`, and decide:

- **Real:** it goes on the action plan as "Claim back …" (see `enargo-action-plan-review`).
  Raising a claim (`raise_claim`) is an analyst act and is not on a client_admin key.
- **False, with a data cause** (missing relief, wrong contract match, a held reissue): fix the
  cause as above and let the re-check clear it.
- **False, with an engine cause:** report it to Enargo with the finding references and what you
  traced. MCP cannot dismiss findings. An Enargo operator dismisses them, with an explicit yes that
  names the count and the reason. For example, false CCL findings raised before a relief was
  recorded are dismissed with the relief as the reason.
- Small duplicates such as `duplicate-invoices-or-charge-lines` on a standing charge are often an
  invoice and its reissue both priced. Check the credit pairing from step 0.

## 8. Write it up

Save a short reconciliation note next to the PDFs (for example
`<client>/<site>-network-reconciliation-<date>.md`). Cover the overcharges found, with invoice
numbers and evidence; what matches published rates; the gaps caused by loading (not the bills);
and what can't be checked and what would settle it. Then list what still needs the client, such as
statements of account for payments and credit allocation.
