---
name: enargo-client-onboarding
description: Use when setting up a new client in Enargo through MCP: estate, sites and MPANs, contract filing and confirmation, half-hourly exports and layout approval, reliefs and supplier accounts.
---

# Onboard a client into Enargo

Read `enargo-mcp` first. This is the order a multi-site industrial client was onboarded in (sites, MPANs,
a flexible supply contract, bills and HH files). Each step says which seat it needs.

## 1. Tenant and key (a person, as platform operator)

An MCP key cannot create a tenant. A platform operator signs in at `/ops/clients` (Clients &
tenants), creates the client, and issues a **Tool surface (MCP)** key on its Credentials page,
normally `client_admin`. The secret is shown once. Store it as env secrets, never in the repo or in
memory files. Inviting the client's own people (`invite_member`) is also operator-only, and it
sends an email. Don't do it without the user's yes.

## 2. Estate (client_admin key)

1. Build a list of sites and MPANs/MPRNs from the data pack (contract schedule, bills, HH export)
   before calling anything. Flag any site name you had to guess.
2. `add_site` `{name, address?}`, then `list_sites` for the ids.
3. `add_meter_point` `{siteId, fuel, identifier, distributor?}`. The identifier is validated as an
   MPAN core (13 digits) or MPRN. Adding a meter releases any bill already held for naming it.
4. Correcting an address or placing a site on the map is operator-only (`set_site_address`,
   `locate_site`).
5. An operator can then run `load_network_register_from_electralink` `{tenantId, dryRun: true}`,
   and the real run after that. It records each meter's LLFC, profile class, energisation and
   registered supplier, which the LLFC check and the registration watch read. The trial key allows
   about 10 lookups an hour.

## 3. Mandate

`file_letter_of_authority` `{reference, validFrom, validTo, signedOn, scopes, filename,
contentType, contentBase64}` is needed before a supplier or data-collector HH export will load.
Exports the client gives you directly use route `client-upload` and need no mandate.

## 4. Contract

1. `file_contract` `{supplier, contractReference?, accountReference?, termFrom, termTo, fuel,
   filename, contentType, contentBase64}`.
2. Wait, then call `list_contracts`. While the parsed terms await confirmation, it carries the
   review: every proposal with its clause and confidence, and every clause the parser declined.
   Check each proposed rate against the PDF yourself (for example per-MPAN standing charges and kVA
   capacities). A declined clause prices nothing, confirmed or not.
3. `confirm_contract` `{contractId}` runs as the key's own account, which is recorded as the
   confirmer. It then re-sends every covered invoice. It needs a yes, because it releases the terms
   to price real bills.
4. **Match the bills' supplier name.** Contracts are filed under the name on the paper (often the
   parent company), but bills are read under the trading brand on them. Once the first bills have
   read, compare them with `list_invoices` and call `restate_contract_supplier` if they differ.
   Restating is the fix. Don't ask for an alias table.

## 5. Half-hourly data

1. **Prepare the file.**
   - It must be delimited text (CSV, TSV or TXT) under about 4 MB. Split it per MPAN if needed.
   - Check the time basis. If the morning ramp moves an hour between summer and winter, and
     clock-change days still have 48 values, the data is UTC. Re-number it to GB settlement day and
     period (46 on the spring day, 50 on the autumn day).
   - Don't add, drop or round values.
2. **Find or propose a layout.**
   - `read_consumption_layouts` shows every proposal with its JSON. The reader uses the highest
     approved version for the provider whose `detect` strings **all** appear in the header row. It
     refuses the file if no layout matches, or if two do.
   - If none fits, call `propose_consumption_layout` `{provider, layout, note}`. Every fault comes
     back at once. An example layout for a supplier export:

   ```json
   {"series": "electricity-half-hourly", "shape": "long",
    "detect": ["mpan_core", "settlement_date_local", "settlement_period_local", "kwh", "status"],
    "headerRow": 1, "timezoneBasis": "Europe/London", "unit": "kWh", "flow": "import",
    "columns": {"meterPoint": "mpan_core", "day": "settlement_date_local",
                "period": "settlement_period_local", "value": "kwh", "quality": "status"},
    "qualityMap": {"A": "actual", "E": "estimated", "C": "derived"}}
   ```

   A wide file lists 48 or 50 `valueColumns` instead of `period` and `value`. A file with no
   status column states `declaredQuality` instead of `qualityMap`. In the `note`, say what was done
   to the file and anything you guessed, such as what a status code means.
3. **Approval is a staff act** (`approve_consumption_layout` / `reject_consumption_layout`
   `{proposalId, note}`), and it is not on a client_admin key. A layout applies to every client's
   exports from that provider. Ask the user (or another analyst or operator) to approve it
   while signed in as themselves, and give them the proposal id and what to check. Exports refused
   before approval are not re-read, so upload them again afterwards.
4. **Upload.** Call `upload_consumption` `{supplier, route, requestedOn, filename, contentType,
   contentBase64}`. `supplier` must be the layout's `provider` exactly. `requestedOn` is when the
   data was requested; it is not defaulted to today.
5. **Verify.** `list_documents` shows `consumptionOutcome`, `readingsImport` and the covered
   window. `list_consumption_coverage` shows, per meter, the span held, how many readings, how
   many are missing and how many are not actual.

## 6. Bills

Follow `enargo-bill-load-and-check`.

## 7. Supplier accounts, reliefs and the rest

- `state_supplier_account` for each supply account (live or terminated, site, payment method).
  This is what refund sheets and statements reconcile against.
- Reliefs: record what the bills and certificates show (`record_tax_relief`,
  `record_levy_exemption`). Call `confirm_tax_position` only once the client confirms the list is
  complete. Until then the VAT and CCL checks don't run.
- Gas meters need an operator to call `state_gas_supply_point` (LDZ, AQ, SOQ) before gas checks
  can convert volume.
- Finish with `list_actions` (see `enargo-action-plan-review`) and a short note of what is loaded,
  what is held and what the client still needs to send, ranked by value.

Every write in steps 2 to 7 is on the client's live data. Get one yes for the onboarding batch,
naming the client and what will be loaded, and ask again for anything outside it.
