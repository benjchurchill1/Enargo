#!/usr/bin/env node
// Enargo MCP bridge: a stdio MCP server that forwards every JSON-RPC message to an Enargo
// deployment's /mcp endpoint, signing in with the client's own key.
//
// Enargo's /mcp takes a short-lived access token, exchanged from a client id and secret at
// /api/v1/token. Most MCP clients can only send a fixed header, so this bridge does the
// exchange and exchanges again when the token runs out. It has no dependencies (Node 18+).
//
// Environment:
//   ENARGO_CLIENT_ID      the key id (starts with "k"), issued under Clients & tenants > Credentials
//   ENARGO_CLIENT_SECRET  its secret, shown once when it was issued
//   ENARGO_URL            the deployment, default https://app.enargo.ai
//
// Nothing is written to disk. Diagnostics go to stderr; stdout carries only protocol messages.

/* global process, fetch */
import { createInterface } from 'node:readline'

const BASE = (process.env.ENARGO_URL || 'https://app.enargo.ai').replace(/\/+$/, '')
const CLIENT_ID = process.env.ENARGO_CLIENT_ID || ''
const CLIENT_SECRET = process.env.ENARGO_CLIENT_SECRET || ''

const log = (...a) => process.stderr.write(`[enargo-mcp] ${a.join(' ')}\n`)
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')

let token = null
let tokenExpiresAt = 0

async function getToken(force = false) {
  if (!force && token && Date.now() < tokenExpiresAt - 60_000) return token
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('ENARGO_CLIENT_ID and ENARGO_CLIENT_SECRET must be set to an Enargo MCP key')
  }
  const res = await fetch(`${BASE}/api/v1/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  })
  if (!res.ok) throw new Error(`token exchange refused (HTTP ${res.status}); check the key`)
  const body = await res.json()
  if (!body.access_token) throw new Error('token exchange returned no access_token')
  token = body.access_token
  tokenExpiresAt = Date.now() + (Number(body.expires_in) || 3600) * 1000
  return token
}

// /mcp may answer as JSON or as a server-sent event stream; take every JSON-RPC message from either.
async function readMessages(res) {
  const text = await res.text()
  if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
    return text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .filter(Boolean)
      .map((d) => JSON.parse(d))
  }
  return text.trim() ? [JSON.parse(text)] : []
}

async function forward(msg, retried = false) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${await getToken(retried)}`,
    },
    body: JSON.stringify(msg),
  })
  if (res.status === 401 && !retried) return forward(msg, true)
  if (res.status === 202 || res.status === 204) return []
  if (!res.ok && !(res.headers.get('content-type') || '').includes('json')) {
    throw new Error(`Enargo answered HTTP ${res.status}`)
  }
  return readMessages(res)
}

async function handle(line) {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    return
  }
  try {
    for (const reply of await forward(msg)) send(reply)
  } catch (err) {
    log(err.message)
    if (msg.id !== undefined && msg.id !== null) {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: `Enargo: ${err.message}` } })
    }
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
let queue = Promise.resolve()
rl.on('line', (line) => {
  if (!line.trim()) return
  // Keep replies in request order; one slow call holds the next, which matches how clients use it.
  queue = queue.then(() => handle(line))
})
rl.on('close', () => queue.then(() => process.exit(0)))
