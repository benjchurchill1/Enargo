---
name: enargo-mcp
description: Use before calling any Enargo MCP tool (app.enargo.ai/mcp). Covers connecting, what each key role can call, the replay and money gotchas, and the rule that live client data changes need explicit approval.
---

# Working with Enargo through its MCP server

Enargo checks a client's energy bills against contracts, published rates and half-hourly data. Its
MCP server at `https://app.enargo.ai/mcp` lets an agent do what a person does in the portal. This skill
covers using it safely, plus the lessons learned using it on real clients.

The workflow skills build on this one:

- `enargo-bill-load-and-check`: load a batch of bills and check them.
- `enargo-client-onboarding`: set up a new client, its estate, contract and half-hourly data.
- `enargo-action-plan-review`: review the action plan, findings, alerts and savings.

## Rule zero: live client data needs an explicit yes

Every write tool changes a real client's data on production. Before any write, get the user's
explicit yes in writing, naming the action and the target. For example: "yes, record the
PP11 for the main site, 95% from 1 Apr 2022". A general "go ahead and improve things" is not enough
for live client data. Reads need no approval.

Writes include uploads, contract confirmation, restating a supplier, repricing, reliefs, budget,
action updates, alert acknowledgements, sites and meter points. Once you have a yes for a batch
(for example "upload all 40 bills"), it covers that batch. Ask again for anything new.

## Connecting

This plugin ships an `enargo` MCP server that does the sign-in for you. It reads three environment
variables:

- `ENARGO_CLIENT_ID` and `ENARGO_CLIENT_SECRET`: a client-credentials key, issued per client in
  Enargo under **Clients & tenants > Credentials** (Tool surface MCP, with a role). The secret is
  shown once.
- `ENARGO_URL`: the deployment, `https://app.enargo.ai` unless told otherwise.

The bridge exchanges the key for an access token at `/api/v1/token`, exchanges it again when it
runs out, and forwards every call to `/mcp`. If the tools are missing, check that the variables are
set and that the machine can reach the deployment.

To call the server without the plugin (for example from a script):

```python
import json, os, urllib.request

BASE = os.environ.get("ENARGO_URL", "https://app.enargo.ai")

def post(url, body, headers=None):
    req = urllib.request.Request(url, json.dumps(body).encode(), {
        **(headers or {}),
        "content-type": "application/json",
        "accept": "application/json, text/event-stream",   # /mcp needs both
    })
    return json.load(urllib.request.urlopen(req))

token = post(f"{BASE}/api/v1/token", {
    "grant_type": "client_credentials",
    "client_id": os.environ["ENARGO_CLIENT_ID"],
    "client_secret": os.environ["ENARGO_CLIENT_SECRET"],
})["access_token"]

def call(name, args=None):
    reply = post(f"{BASE}/mcp",
                 {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                  "params": {"name": name, "arguments": args or {}}},
                 {"authorization": f"Bearer {token}"})
    return reply["result"]["structuredContent"]
```

`/mcp` takes only an access token. A deployment may also offer `/mcp/relay`, which takes a fixed
shared secret (`Authorization: Bearer <secret>` or `X-API-Key: <secret>`) and acts as one
configured key. Never send the relay secret to `/mcp`, or an access token to `/mcp/relay`. Both
fail as a 401 that some clients report as "couldn't reach the server".

Run `tools/list` first. It returns only the tools this key's role is offered.

## What each role can call

| Role | Offered |
|---|---|
| `client_viewer` | Reads only (`list_*`). |
| `client_admin` | Reads, plus uploads, contracts, sites and meter points, reliefs, the supplier ledger, network charges, budget, monitoring, compliance and the action plan. About 72 tools. |
| `analyst`, `claim_approver` | Reads, uploads and contract tools, plus `raise_claim` and the staff tools: approving rate versions, HH layouts and line mappings. Approvals apply to **every** client. They do **not** get the `client_admin` estate tools (sites, ledger, reliefs, action plan, monitoring, compliance), which are `ESTATE_ROLES`. |
| platform operator | Tenant administration (`create_tenant`, `invite_member`, `issue_api_access`, `read_estate`, `read_held_artefacts`, `read_inbound_mail`, `load_network_register_from_electralink`, `state_gas_supply_point`). No issuable key holds this. |

Keys issued for clients are normally `client_admin`. So `approve_consumption_layout`,
`approve_line_mapping`, `raise_claim` and the operator reads are **not** on that key. They need a
person with the right seat in the portal, signed in as themselves.

## What the surface never does

- **It cannot write or dismiss findings.** Findings come from the engine (§11.3). `list_findings`
  is read-only. A false finding is fixed by fixing its cause (a missing relief, a wrong contract
  match, a reader bug), and the engine then re-checks. Dismissing a finding outright is an
  operator act outside MCP, and it needs an explicit yes. `update_action` with `dismissed` only
  closes the action plan row, not the findings behind it.
- No claim approval, no sign-in, no notifications.

## Gotchas learned the hard way

1. **A byte-identical repeat is a replay, not a second run.** Every write carries an idempotency
   key, `sha256(endpoint + request body)`, which is honoured for 24 hours. Calling
   `reprice_contract` again with the same `contractId` returns the first reply and sends nothing.
   So a retry after a timeout is safe, but "run it again now that X is fixed" silently does
   nothing. Reads that use a write door (`list_actions`, `read_tax_position`,
   `list_monitoring_alerts` and similar) are never replayed. If you really need to re-send
   calculations within 24 hours, say so and ask an operator. Do not change arguments just to dodge
   the key.
2. **Money is a decimal string.** `"47191.9400"`. Never parse it as a float to add it up. Use
   `decimal.Decimal` or quote the figure.
3. **Never add confirmed, claimed and estimated money together.** One-off sums and yearly savings
   are different things. Quote `list_actions`' `headline` instead of building your own total.
4. **Identity comes from the token.** No tool takes `tenantId`, `actorId` or `approvedBy`, except
   the operator tools, where the tenant is the subject. You cannot act for another client with a
   client key.
5. **The work happens after the reply.** Uploads, repricing, relief re-checks and mapping
   approvals queue jobs. The worker takes about 20 jobs every 5 minutes, so 60 bills take a while.
   Check `list_documents` and `list_findings` later instead of polling in a loop.
6. **Writes need `JOBS_SHARED_SECRET` on the deployment.** "Unconfigured" is a configuration state.
   Retrying will not fix it.
7. **Lists are paged** (`limit`, `offset`, `hasMore`). Page through before saying something is
   missing.

## Reporting back

Lead with the outcome in plain words, give money as printed with "ex VAT" or "inc VAT", name bills
by their invoice number, and keep confirmed money apart from estimates. Say what is still waiting
and on whom.
