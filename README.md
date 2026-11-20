# Enargo plugin for Claude

Use [Enargo](https://app.enargo.ai), the energy bill validation platform, from Claude. The plugin
connects Claude to Enargo's MCP server with your own key, and teaches it the workflows that matter:

| Skill | What it does |
|---|---|
| `enargo-mcp` | The basics Claude reads before any Enargo call: roles, gotchas, and the rule that changes to live client data need your explicit yes. |
| `enargo-bill-load-and-check` | Loads a batch of supplier bills and credit notes and checks them against half-hourly data, the contract, levy reliefs and network charges, then works through the findings. |
| `enargo-client-onboarding` | Sets up a client: sites and meter points, mandate, contract, half-hourly exports and layouts, supplier accounts and reliefs. |
| `enargo-action-plan-review` | Says where a client stands: money owed back, estimated savings, deadlines, findings and alerts, and records progress on actions. |

## Install

In Claude Code:

```
/plugin marketplace add benjchurchill1/Enargo
/plugin install enargo@enargo
```

You can also install the packaged `enargo.plugin` file in the Claude desktop app.

## Connect

You need an Enargo MCP key. In Enargo, a platform operator issues one for your client under
**Clients & tenants > Credentials** (Tool surface: MCP). Choose the narrowest role that does the job:
`client_viewer` only reads, and `client_admin` can also file documents and record changes. The
secret is shown once.

Set these in the environment Claude runs in:

```bash
export ENARGO_CLIENT_ID=k...           # the key id
export ENARGO_CLIENT_SECRET=...        # its secret
export ENARGO_URL=https://app.enargo.ai   # optional; this is the default
```

The bundled server (`server/enargo-mcp.mjs`, Node 18 or later, no dependencies) exchanges the key
for a short-lived access token, renews it, and forwards each call to `${ENARGO_URL}/mcp`. It writes
nothing to disk. Treat the secret like a password: whoever holds it can act as that role on that
client's data.

## Safety

Every write tool acts on live client data. The skills tell Claude to get your explicit yes, naming
the action and the target, before any write, and to keep confirmed money apart from estimates. A
key can only reach the one client it was issued for.

## Licence

MIT
