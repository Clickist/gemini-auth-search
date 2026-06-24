/**
 * Gemini Grounding Search — Antigravity OAuth path.
 * Dependency-free Node.js 18+ reference implementation.
 *
 * First run: opens browser for Google login, caches token, searches.
 * Subsequent runs: reuse cached token, auto-refresh when expired.
 *
 * Usage: node gemini-search.mjs "your search query"
 */
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";

// --- Antigravity OAuth app credentials (public client app creds, base64-encoded
// the same way oh-my-pi ships them; decoded at runtime via atob) ---
const decode = (s) => Buffer.from(s, "base64").toString();
const CLIENT_ID = decode(
  "MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlcC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==",
);
const CLIENT_SECRET = decode("R09DU1BYLUs1OEZXUjQ4NkxkTEoxbUxCOHNYQzR6NnFEQWY=");
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "openid", "email", "profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];
const CALLBACK_PORT = 51121;
const CALLBACK_PATH = "/oauth-callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const CODE_ASSIST = "https://cloudcode-pa.googleapis.com";
const SEARCH_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
const DEFAULT_MODEL = "gemini-2.5-flash";
const CRED_PATH = path.join(os.homedir(), ".gemini", "oauth_creds_antigravity.json");

function userAgent() {
  const osName = process.platform === "win32" ? "windows" : process.platform;
  const arch = process.arch === "x64" ? "amd64" : process.arch === "ia32" ? "386" : process.arch;
  return `antigravity/hub/2.1.4 ${osName}/${arch}`;
}

// --- credential store ---
function loadCreds() {
  try { return JSON.parse(fs.readFileSync(CRED_PATH, "utf8")); } catch { return null; }
}
function saveCreds(c) {
  fs.mkdirSync(path.dirname(CRED_PATH), { recursive: true });
  fs.writeFileSync(CRED_PATH, JSON.stringify(c, null, 2));
}

// --- token lifecycle ---
async function refreshToken(creds) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: creds.refresh, grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const d = await res.json();
  const updated = { ...creds, token: d.access_token, expires: Date.now() + d.expires_in * 1000 - 300_000 };
  saveCreds(updated);
  return updated;
}

async function discoverProject(token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": userAgent(),
  };
  const res = await fetch(`${CODE_ASSIST}/v1internal:loadCodeAssist`, {
    method: "POST", headers,
    body: JSON.stringify({ metadata: { ideType: "ANTIGRAVITY", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" } }),
  });
  if (!res.ok) throw new Error(`loadCodeAssist failed: ${await res.text()}`);
  const d = await res.json();
  if (d.cloudaicompanionProject) return d.cloudaicompanionProject;
  throw new Error("No project returned — this account may need a different tier. See SKILL.md.");
}

async function oauthLogin() {
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
  });
  const url = `${AUTH_URL}?${params}`;

  console.error("Opening browser for Google login...");
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  try { execSync(`${opener} "${url}"`, { stdio: "ignore" }); }
  catch { console.error(`Could not open browser. Visit:\n${url}`); }

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);
      if (u.pathname !== CALLBACK_PATH) { res.writeHead(404).end("Not found"); return; }
      const c = u.searchParams.get("code");
      const err = u.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<body style="font-family:sans-serif;padding:2em"><h2>${c ? "✓ Login successful — close this tab." : `✗ ${err}`}</h2></body>`);
      server.close();
      c ? resolve(c) : reject(new Error(`OAuth error: ${err}`));
    });
    server.listen(CALLBACK_PORT, "127.0.0.1", () => console.error(`Waiting for callback on port ${CALLBACK_PORT}...`));
    server.on("error", reject);
  });

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      code, grant_type: "authorization_code", redirect_uri: REDIRECT_URI,
    }),
  });
  if (!tokenRes.ok) throw new Error(`Token exchange failed: ${await tokenRes.text()}`);
  const td = await tokenRes.json();
  if (!td.refresh_token) throw new Error("No refresh token — retry login");

  console.error("Discovering project...");
  const projectId = await discoverProject(td.access_token);
  const creds = { token: td.access_token, refresh: td.refresh_token, expires: Date.now() + td.expires_in * 1000 - 300_000, projectId };
  saveCreds(creds);
  console.error(`Credentials saved to ${CRED_PATH}`);
  return creds;
}

async function getToken() {
  const creds = loadCreds();
  if (!creds) return oauthLogin();
  if (Date.now() >= creds.expires) return refreshToken(creds);
  return creds;
}

// --- search ---
export async function geminiSearch(query, { systemPrompt, maxOutputTokens } = {}) {
  const { token, projectId } = await getToken();

  const forceSearch = "You are a web search assistant. You MUST use Google Search to find current information before answering. Always ground your response in real search results and cite sources. Never answer from your own training data alone.";
  const body = {
    project: projectId,
    model: DEFAULT_MODEL,
    userAgent: "antigravity",
    requestId: `agent-${crypto.randomUUID()}`,
    request: {
      contents: [{ role: "user", parts: [{ text: query }] }],
      tools: [{ googleSearch: {} }],
      systemInstruction: { parts: [{ text: forceSearch }, ...(systemPrompt ? [{ text: systemPrompt }] : [])] },
      ...(maxOutputTokens && { generationConfig: { maxOutputTokens } }),
    },
  };

  const res = await fetch(`${SEARCH_ENDPOINT}/v1internal:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "User-Agent": userAgent(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);

  const answer = [];
  const sources = [];
  const citations = [];
  const searchQueries = [];
  const seen = new Set();
  const reader = res.body.getReader();
  let buf = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        let chunk;
        try { chunk = JSON.parse(line.slice(5).trim()); } catch { continue; }
        const c = chunk?.response?.candidates?.[0];
        for (const p of c?.content?.parts ?? []) if (p.text) answer.push(p.text);
        const gm = c?.groundingMetadata;
        if (!gm) continue;
        for (const g of gm.groundingChunks ?? []) {
          if (g.web?.uri && !seen.has(g.web.uri)) {
            seen.add(g.web.uri);
            sources.push({ title: g.web.title ?? g.web.uri, url: g.web.uri });
          }
        }
        for (const s of gm.groundingSupports ?? []) {
          for (const idx of s.groundingChunkIndices ?? []) {
            const g = gm.groundingChunks?.[idx];
            if (g?.web?.uri) citations.push({ url: g.web.uri, title: g.web.title ?? g.web.uri, citedText: s.segment?.text });
          }
        }
        for (const q of gm.webSearchQueries ?? []) if (!searchQueries.includes(q)) searchQueries.push(q);
      }
    }
  } finally { reader.releaseLock(); }

  // If sources + searchQueries are both empty, Gemini skipped the search and
  // answered from memory — the answer may be unverified. Surface this to the
  // caller rather than trusting it silently.
  return { answer: answer.join(""), sources, citations, searchQueries };
}

// --- CLI ---
const query = process.argv[2];
if (!query) {
  console.error("Usage: node gemini-search.mjs \"your search query\"");
  process.exit(1);
}
const result = await geminiSearch(query);
console.log("\n=== Answer ===");
console.log(result.answer || "(no text)");
console.log("\n=== Sources ===");
for (const s of result.sources) console.log(`- ${s.title}\n  ${s.url}`);
console.log("\n=== Search Queries ===");
for (const q of result.searchQueries) console.log(`- ${q}`);
