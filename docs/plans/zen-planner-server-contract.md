# Server contract + self-host recipe — zen-planner Phase 2 (remote inference)

> **Historical / superseded.** The `web/src/llm/*` modules this document
> describes (`ollama.js`, `config.js`) have since been removed from the repo
> -- the local-model/Ollama integration was pulled out entirely (see
> README.md's "Earlier versions could call a local Ollama endpoint..." note).
> Nothing here describes a live code path or an active plan; it is kept for
> historical reference only, in case a future remote-inference gateway effort
> wants the original server contract as a starting point.

This is the canonical copy of the "Server contract" section from the zen-planner
plan (`gentle-knitting-lark.md`), plus a concrete self-host recipe. It exists so
whoever stands up the gateway — FACSI IT, or Daniel self-hosting — has one
document to hand over, without needing the full plan file.

**No backend service code lives in this repo.** The app (`web/src/llm/ollama.js`,
`web/src/llm/config.js`) is a client that speaks to *one HTTPS gateway* someone
else operates in front of an Ollama box. This doc describes exactly what that
gateway needs to do.

## Server contract

- **HTTPS** with a valid cert. The public app is served over HTTPS (GitHub
  Pages); browsers silently block HTTPS→HTTP requests, so a plain-HTTP Ollama
  box is unreachable from the deployed app no matter what.
- **CORS**: `Access-Control-Allow-Origin` = the Pages origin (and `Authorization`,
  `Content-Type` in `Access-Control-Allow-Headers`).
- **Auth**: a bearer token required on every request. An open GPU endpoint on
  the public internet gets abused; the token is the only thing standing
  between "my lab's model" and "everyone's model."
- **Rate limit**: **~5 requests/hour per token**, enforced *here*, authoritatively.
  The client (`web/src/llm/rateLimit.js`) shows a soft "N left this hour"
  counter as a courtesy, but it is not enforcement — a user can clear
  localStorage and keep sending requests, so the server must be the real gate.
- **`POST /api/chat`**: reverse-proxy to Ollama's own `/api/chat`, unchanged.
  The app's Ollama provider already speaks this API; the gateway's only job
  here is HTTPS + CORS + auth in front of it, not translating the protocol.
- **`POST /extract`** (or `/advise`, Phase 3, not yet built): accepts uploaded
  files, extracts text, runs inference, returns advice + a session id.
- **`POST /clear`** (Phase 3, not yet built): purges a session's uploaded
  files/text on user approval, plus a server-side TTL auto-purge as
  defense-in-depth (a user who never clicks Approve must still get purged).

Only `/api/chat` is needed for what's shipped so far (Phase 2's client wiring).
`/extract` and `/clear` are Phase 3 and not yet implemented on the client side.

## What the client sends

`createOllamaProvider({ endpoint, model, token })` (`web/src/llm/ollama.js`)
posts to `${endpoint}/api/chat` with `Content-Type: application/json` and,
**only when a token is configured**, `Authorization: Bearer <token>`. A bare
LAN Ollama box (no gateway, `token` left blank in the settings UI) gets no
Authorization header at all — this is the existing default and stays fully
supported; the token is additive, not a required migration.

The endpoint/model/token are set in the guidance panel's settings row
(`web/src/ui/guidance.js`) and persisted via `web/src/llm/config.js`
(`localStorage`, never sent anywhere but to the configured endpoint itself).

## Self-host recipe (for Daniel, if IT won't operate a gateway)

A minimal reverse proxy in front of a LAN Ollama instance, using
[Caddy](https://caddyserver.com/) for automatic HTTPS + a token check. (A
Cloudflare Tunnel is an equally valid alternative if inbound ports are a
problem — same shape, different transport.)

```
# Caddyfile
your-subdomain.example.com {
    @authorized {
        header Authorization "Bearer YOUR_LONG_RANDOM_TOKEN"
    }
    @options {
        method OPTIONS
    }

    header {
        Access-Control-Allow-Origin "https://daniel-waiger.github.io"
        Access-Control-Allow-Headers "Authorization, Content-Type"
        Access-Control-Allow-Methods "POST, OPTIONS"
    }

    respond @options 204

    handle @authorized {
        reverse_proxy localhost:11434
    }
    handle {
        respond 401
    }
}
```

Caddy handles the HTTPS cert automatically (Let's Encrypt) given a real
domain/subdomain pointed at the box. The rate limit isn't shown above —
Caddy's `rate_limit` needs a plugin build; a simpler option is a tiny
reverse-proxy script (Node/Go) that just wraps Ollama and adds a per-token
sliding-window counter, if the plugin route is too much setup for a "keep it
small" self-host. Either way, the 5/hr number should live in the gateway, not
be inferred from the client.

**Generating a token**: any long random string works, e.g. `openssl rand -hex 32`.
Put the same value into the app's settings-row token field.

## Out of scope here

- Operating the gateway at runtime — this doc describes how, not who runs it
  day-to-day.
- `/extract` and `/clear` (Phase 3, doc-upload advice) — no client code calls
  these yet.
- Google Calendar OAuth (Phase 4) — entirely separate, no relation to this
  gateway.
