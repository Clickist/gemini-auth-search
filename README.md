# Gemini Auth Search

**[English](README.md) | [中文](README.zh-CN.md)**

> **⚡ One-line install (Claude Code / agent):** copy this, paste to your agent —
>
> ```
> Install this as a system-level Claude Code skill for free web search via Gemini OAuth (no API key needed): https://github.com/Clickist/gemini-auth-search
> ```


Free web search via **Gemini grounding + Google OAuth** — no paid API key required.

**You need:** a Google account (Google One AI Pro recommended — the free tier is geo-restricted) + a network that can reach Google services + Node.js 18+.

It piggybacks on Google's Cloud Code Assist API. You log in once with a Google account, and afterward you can send search queries that return grounded answers with real source URLs.

## Who can use it

You need a Google account that's recognized by the **Antigravity** OAuth app:

- ✅ **Google One AI Pro** subscribers — confirmed working. The Antigravity app recognizes your subscription (`paidTier: g1-pro-tier`) and grants usage.
- ✅ Accounts in supported regions for the free tier.
- ⚠️ Accounts in **unsupported locations** won't get free-tier quota, but the Antigravity/Pro path still works if you have a Pro subscription.

> The alternate Gemini CLI OAuth app is geo-restricted for the free tier and often returns "not eligible in your location". **The Antigravity app is the reliable path** — this project uses it by default.

## What you get

A single function `geminiSearch(query)` that:

1. Authenticates with your Google account (browser OAuth, once).
2. Caches the token locally; auto-refreshes when it expires.
3. Sends your query to Gemini with Google Search grounding enabled.
4. Returns: `{ answer, sources[], citations[], searchQueries[] }`

```javascript
import { geminiSearch } from "./gemini-search.mjs";

const result = await geminiSearch("latest Rust release notes");
console.log(result.answer);    // grounded answer text
console.log(result.sources);   // [{ title, url }, ...]
```

Or run it as a CLI:

```bash
node gemini-search.mjs "your search query"
```

First run opens a browser for Google login. Subsequent runs reuse the cached token at `~/.gemini/oauth_creds_antigravity.json`.

## Boundaries — what it CAN'T do

Be aware of these limits before depending on it:

- **Model is locked to `gemini-2.5-flash`.** `gemini-2.5-pro` exists on the endpoint but returns 503 (no capacity). Gemini 3.x models return 404. Don't try to swap models.
- **It's single-shot grounding, not deep research.** Each call does one search round then answers. There is no multi-round auto-digging — Gemini Deep Research is a separate consumer product, not exposed via this API. For research depth, orchestrate multiple calls yourself.
- **Grounding can't be forced via config.** `dynamicRetrievalConfig` / `MODE_DYNAMIC` are rejected by this internal endpoint. The reference implementation uses a system prompt to nudge Gemini toward searching.
- **Gemini may skip the search** and answer from memory for questions it thinks it knows (e.g. "what day is it"), returning empty sources. The reference implementation documents this check — treat empty sources as "unverified answer".
- **Sources come only from Google Search.** The `googleSearch` tool is Google-only; there's no Brave/Bing option through this path.
- **Rate limits apply.** Even on Pro, rapid-fire requests get throttled. The correct `User-Agent` header (`antigravity/hub/...`) unlocks more generous limits — the implementation sets it for you.

## How it works (one paragraph)

You log in via Google's OAuth using the Antigravity app credentials (public OAuth client-app credentials, base64-encoded in the source). The OAuth flow provisions a Cloud Code Assist project on your account. You then call `streamGenerateContent` with `{ googleSearch: {} }` as a tool; Gemini uses Google Search internally and returns the answer plus `groundingMetadata` containing the source URLs and the queries it actually ran.

## Requirements

- Node.js 18+ (uses built-in `fetch`, `http`, `crypto`).
- A Google account (Pro subscription recommended — see above).
- A browser for the one-time OAuth login.

## Use as a Claude Code skill

Install it so Claude Code can do Gemini-grounded web search:

```bash
# 1. Create the skill directory
mkdir -p ~/.claude/skills/gemini-grounding-search

# 2. Copy the two files into it
curl -o ~/.claude/skills/gemini-grounding-search/SKILL.md \
  https://raw.githubusercontent.com/Clickist/gemini-auth-search/main/claude-skill/SKILL.md
curl -o ~/.claude/skills/gemini-grounding-search/gemini-search.mjs \
  https://raw.githubusercontent.com/Clickist/gemini-auth-search/main/gemini-search.mjs
```

After that, the skill `gemini-grounding-search` is available system-wide. Or just paste the one-line prompt at the top of this README to your agent and let it do the install for you.

> The script lives next to `SKILL.md` so it's co-located — Claude Code reads the skill, then runs `node gemini-search.mjs "<query>"` via Bash. First search triggers the browser OAuth login.

## License

MIT
