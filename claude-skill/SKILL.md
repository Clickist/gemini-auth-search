---
name: gemini-grounding-search
description: Use when implementing web search via Gemini's Cloud Code Assist grounding using free Google OAuth — no paid API key. Covers OAuth browser login (Antigravity app, works with Google One AI Pro), token caching/refresh, GCP project discovery, grounding API requests, and SSE result parsing with citations.
---

# Gemini Grounding Search (Free OAuth, No API Key)

Uses Google's Cloud Code Assist API with OAuth — passes `{ googleSearch: {} }` as a Gemini tool; Gemini does the actual search and returns grounded sources. Two OAuth apps unlock this; **the Antigravity app is the reliable path** because it works with a Google One AI Pro subscription and is not geo-restricted like the free tier.

## Two OAuth Apps — Which to Use

| App | OAuth Client | Works for | Endpoint |
|-----|-------------|-----------|----------|
| **Antigravity** (recommended) | DeepMind's `1071006060591-...` | Google One AI Pro accounts, daily build | `daily-cloudcode-pa.googleapis.com` |
| Gemini CLI | Gemini CLI's `681255809395-...` | Free-tier-eligible accounts only (geo-restricted) | `cloudcode-pa.googleapis.com` |

**Symptom that points here:** user has Google One AI Pro but the Gemini CLI app returns `ineligibleTiers: [{ reasonCode: "UNSUPPORTED_LOCATION" }]` with no free-tier quota. Switch to the Antigravity app — it recognizes the Pro subscription via `paidTier: { id: "g1-pro-tier" }` and returns a usable `cloudaicompanionProject`.

## Antigravity App Credentials (public, embedded in oh-my-pi source)

OAuth client app credentials — base64-encoded and decoded at runtime, the same way oh-my-pi ships them:

```
CLIENT_ID (b64):     MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlcC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==
CLIENT_SECRET (b64): R09DU1BYLUs1OEZXUjQ4NkxkTEoxbUxCOHNYQzR6NnFEQWY=
TOKEN_URL:     https://oauth2.googleapis.com/token
AUTH_URL:      https://accounts.google.com/o/oauth2/v2/auth
SCOPES:        cloud-platform openid email profile cclog experimentsandconfigs
CALLBACK:      http://localhost:51121/oauth-callback
SEARCH:        https://daily-cloudcode-pa.googleapis.com
USER-AGENT:    antigravity/hub/2.1.4 {os}/{arch}   ← required, unlocks higher limits
```

## Credential File

`~/.gemini/oauth_creds_antigravity.json`:

```json
{
  "token": "<access_token>",
  "refresh": "<refresh_token>",
  "expires": 1234567890000,
  "projectId": "jaunty-alliance-dr5vm"
}
```

- `expires` is Unix **milliseconds**. Compare with `Date.now()`.
- `projectId` is required — the API returns 400 without it.
- `refresh_token` is long-lived; auto-exchange for a new access token when expired.

## Auth → Search Flow

1. **Load creds** from `~/.gemini/oauth_creds_antigravity.json`.
2. If missing → run OAuth browser login (see reference impl).
3. If `expires` passed → refresh via TOKEN_URL with `grant_type=refresh_token`.
4. **Discover project** once after fresh login: POST `cloudcode-pa.googleapis.com/v1internal:loadCodeAssist` with `metadata: { ideType: "ANTIGRAVITY", pluginType: "GEMINI" }`, read `cloudaicompanionProject`.
5. **Search**: POST `daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse` with the grounding body, parse SSE.

## Search Request Body

```json
{
  "project": "<projectId>",
  "model": "gemini-2.5-flash",
  "userAgent": "antigravity",
  "requestId": "agent-<uuid>",
  "request": {
    "contents": [{ "role": "user", "parts": [{ "text": "query" }] }],
    "tools": [{ "googleSearch": {} }]
  }
}
```

Headers:
```
Authorization: Bearer <token>
Content-Type: application/json
Accept: text/event-stream
User-Agent: antigravity/hub/2.1.4 darwin/arm64
```

## SSE Response — Extract These Fields

Parse each `data:` line as JSON, from `response.candidates[0]`:

| Path | Meaning |
|------|---------|
| `.content.parts[].text` | Model's answer text |
| `.groundingMetadata.groundingChunks[].web.{uri,title}` | Sources — dedupe by URI |
| `.groundingMetadata.groundingSupports[]` | Citation segments linked to chunks via `groundingChunkIndices` |
| `.groundingMetadata.webSearchQueries[]` | What Gemini actually searched |
| `.usageMetadata` | Token counts |

## Reference Implementation

See `gemini-search.mjs` in this skill directory — a complete, dependency-free Node.js 18+ script (OAuth login + token cache/refresh + project discovery + SSE search). Verified end-to-end.

Run: `node gemini-search.mjs "your query"`

## Boundaries (what this path CAN'T do)

**Model is locked to `gemini-2.5-flash`.** Verified empirically on the `daily-cloudcode-pa` endpoint with Antigravity OAuth:

| Model | Result |
|-------|--------|
| `gemini-2.5-flash` | ✅ Reliable, full grounding |
| `gemini-2.5-pro` | ❌ 503 — exists but server has no capacity for this tier |
| `gemini-3.x` (non-agent) | ❌ 404 — not available on this path |
| `gemini-3-flash-agent` / `gemini-pro-agent` | ⚠️ Routes, but these are **agentic coding** models — grounding behavior unreliable, short answers. Don't use for search. |

**It's single-shot grounding, not deep research.** `streamGenerateContent` + `googleSearch` does ONE search round then answers. There is no `deepResearch` tool and no multi-round auto-digging — Gemini Deep Research is a separate consumer product (gemini.google.com), not exposed via this API. For multi-source research, you must orchestrate multiple `geminiSearch` calls in your application layer (split query → search each → synthesize).

**Grounding can't be forced via config.** `dynamicRetrievalConfig` / `MODE_DYNAMIC` are rejected by this internal endpoint (400 "Cannot find field"). Only `{ googleSearch: {} }` is accepted. To nudge Gemini toward actually searching rather than answering from memory, use a system prompt — see the `forceSearch` prompt in the reference implementation.

## Checking Whether It Actually Searched

Gemini may skip the search and answer from training data (e.g. "what day is it"), returning empty `groundingMetadata`. Detect this and treat as a failure if sources are required:

```javascript
if (result.sources.length === 0 && result.searchQueries.length === 0) {
  // Gemini didn't ground — answer may be unverified
}
```

oh-my-pi does this check (`hasRenderableSearchContent`) then falls through to the next provider. In a single-provider setup, surface the empty-sources case to the caller rather than silently returning a possibly-hallucinated answer.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Using Gemini CLI app for a Pro account | Use the Antigravity app — free tier is geo-restricted |
| No `User-Agent` header | Required: `antigravity/hub/2.1.4 {os}/{arch}` — without it, strict rate limits |
| Switching model hoping for better results | Locked to `gemini-2.5-flash`; pro/3.x don't work here |
| Expecting deep research from one call | Not available — orchestrate multiple searches yourself |
| `dynamicRetrievalConfig` to force search | Rejected on this endpoint — use a system prompt instead |
| Trusting answers with zero sources | Gemini skipped search; treat empty grounding as a failure |
| `expires` as seconds | It's milliseconds — compare with `Date.now()` |
| Non-SSE response assumed | Must parse `data:` lines from the stream |
| Missing `project` field | Always include `projectId` from credentials |
| Wrong endpoint for Antigravity | Use `daily-cloudcode-pa.googleapis.com`, not the stable one |
| `metadata.ideType` wrong | Antigravity needs `ANTIGRAVITY`, not `IDE_UNSPECIFIED` |
