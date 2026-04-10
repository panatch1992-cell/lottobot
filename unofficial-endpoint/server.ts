/**
 * LottoBot Unofficial Endpoint (Deno + @evex/linejs)
 *
 * Uses @evex/linejs for both login and sending to ensure consistent
 * headers/session handling (no V3_TOKEN_CLIENT_LOGGED_OUT).
 *
 * Endpoints:
 *   GET  /health        — status + token info
 *   POST /login         — email/password → PIN → token
 *   GET  /login/check   — poll login status
 *   POST /update-token  — set LINE_AUTH_TOKEN manually
 *   POST /refresh       — refresh token
 *   GET  /groups        — list joined groups
 *   POST /send          — send message (push_text / push_image_text / broadcast)
 *   POST /debug-send    — test send (no auth)
 *   GET  /test          — HTML test page
 */

import { Client, loginWithPassword, loginWithAuthToken } from "jsr:@evex/linejs";

// ─── Config ─────────────────────────────────────────

const PORT = parseInt(Deno.env.get("PORT") || "8080");
const AUTH_TOKEN = (Deno.env.get("UNOFFICIAL_AUTH_TOKEN") || "").trim();
let LINE_AUTH_TOKEN = (Deno.env.get("LINE_AUTH_TOKEN") || "").replace(/\s+/g, "").trim();
const LINE_CHANNEL_TOKEN = (Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") || "").trim();

const LINE_OFFICIAL_API = "https://api.line.me/v2/bot";

// ─── Global linejs client ───────────────────────────

let client: Client | null = null;
let clientReady = false;
let clientInitPromise: Promise<void> | null = null;

async function initClient(): Promise<void> {
  if (!LINE_AUTH_TOKEN) {
    console.warn("[init] No LINE_AUTH_TOKEN, client not initialized");
    return;
  }
  try {
    console.log("[init] Initializing linejs client with auth token...");
    client = await loginWithAuthToken(LINE_AUTH_TOKEN, {
      device: "DESKTOPWIN",
    });
    clientReady = true;
    console.log("[init] ✅ Client ready");
  } catch (err) {
    console.error("[init] ❌ Client init failed:", (err as Error).message);
    clientReady = false;
    client = null;
  }
}

async function ensureClient(): Promise<Client | null> {
  if (clientReady && client) return client;
  if (clientInitPromise) {
    await clientInitPromise;
    return clientReady ? client : null;
  }
  clientInitPromise = initClient();
  await clientInitPromise;
  clientInitPromise = null;
  return clientReady ? client : null;
}

// Init on startup (delayed to let server start listening first)
setTimeout(() => ensureClient(), 1000);

// ─── JWT helpers ────────────────────────────────────

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    // base64url decode
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
    const payload = atob(padded);
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function getTokenExpiry() {
  if (!LINE_AUTH_TOKEN) return { expired: true, expiresIn: 0 };
  const payload = decodeJwtPayload(LINE_AUTH_TOKEN);
  if (!payload || typeof payload.exp !== "number") {
    return { expired: false, expiresIn: Infinity };
  }
  const now = Math.floor(Date.now() / 1000);
  const exp = payload.exp as number;
  return {
    expired: now >= exp,
    expiresIn: exp - now,
    expiresAt: new Date(exp * 1000).toISOString(),
    refreshExpiry: typeof payload.rexp === "number" ? new Date((payload.rexp as number) * 1000).toISOString() : null,
  };
}

// ─── Send helpers ───────────────────────────────────

function getMidType(mid: string): number {
  if (!mid) return 0;
  const prefix = mid.charAt(0).toLowerCase();
  if (prefix === "c") return 2; // GROUP
  if (prefix === "r") return 1; // ROOM
  return 0; // USER
}

async function sendViaUnofficial(to: string, text: string) {
  const c = await ensureClient();
  if (!c) return { success: false, error: "Client not initialized" };

  try {
    console.log(`[unofficial] Sending to ${to.slice(-8)} (type=${getMidType(to)}) text=${text.slice(0, 50)}`);
    // @ts-ignore - linejs types
    const res = await c.base.talk.sendMessage({ to, text });
    console.log(`[unofficial] ✅ Sent, messageId=${res?.id || "?"}`);
    return { success: true, via: "unofficial", messageId: res?.id };
  } catch (err) {
    const msg = (err as Error).message || String(err);
    console.error(`[unofficial] ❌ Send failed: ${msg}`);
    return { success: false, error: msg };
  }
}

async function sendViaOfficial(to: string, messages: Array<Record<string, unknown>>) {
  if (!LINE_CHANNEL_TOKEN) {
    return { success: false, error: "LINE_CHANNEL_ACCESS_TOKEN not configured" };
  }
  try {
    const res = await fetch(`${LINE_OFFICIAL_API}/message/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LINE_CHANNEL_TOKEN}`,
      },
      body: JSON.stringify({ to, messages }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, error: `Official HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}` };
    }
    if (body.message) return { success: false, error: `Official: ${body.message}` };
    console.log(`[official] ✅ Sent to ${to.slice(-8)}`);
    return { success: true, via: "official" };
  } catch (err) {
    return { success: false, error: `Official: ${(err as Error).message}` };
  }
}

// ─── Auth guard ─────────────────────────────────────

function checkAuth(req: Request): boolean {
  if (!AUTH_TOKEN) return true;
  const header = req.headers.get("authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  return bearer === AUTH_TOKEN;
}

// ─── Login sessions ─────────────────────────────────

type LoginSession = {
  status: "waiting" | "success" | "timeout" | "error";
  token?: string;
  error?: string;
  createdAt: number;
};

const loginSessions = new Map<string, LoginSession>();

// ─── Route handlers ─────────────────────────────────

async function handleHealth(_req: Request): Promise<Response> {
  const tokenStatus = getTokenExpiry();
  const payload = decodeJwtPayload(LINE_AUTH_TOKEN);
  const c = clientReady ? client : null;

  return jsonResponse({
    ok: true,
    service: "lottobot-unofficial-endpoint",
    runtime: "deno + @evex/linejs",
    hasAuthToken: !!AUTH_TOKEN,
    hasLineToken: !!LINE_CHANNEL_TOKEN,
    hasUnofficialToken: !!LINE_AUTH_TOKEN,
    clientReady,
    mode: c ? "unofficial (primary)" : (LINE_CHANNEL_TOKEN ? "official only" : "none"),
    tokenDebug: LINE_AUTH_TOKEN
      ? {
          length: LINE_AUTH_TOKEN.length,
          parts: LINE_AUTH_TOKEN.split(".").length,
          decoded: payload
            ? { aid: payload.aid, exp: payload.exp, cmode: payload.cmode, ctype: payload.ctype }
            : "FAILED_TO_DECODE",
        }
      : null,
    token: LINE_AUTH_TOKEN
      ? {
          expired: tokenStatus.expired,
          expiresIn: isFinite(tokenStatus.expiresIn)
            ? `${Math.floor(tokenStatus.expiresIn / 3600)}h`
            : "unknown",
          expiresAt: tokenStatus.expiresAt,
          refreshExpiry: tokenStatus.refreshExpiry,
        }
      : null,
    now: new Date().toISOString(),
  });
}

async function handleLogin(req: Request): Promise<Response> {
  if (!checkAuth(req)) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const email = body.email;
  const password = body.password;

  if (!email || !password) {
    return jsonResponse({ success: false, error: "email and password required" }, 400);
  }

  console.log(`[login] Starting login for ${email.slice(0, 3)}***`);

  // Create session
  const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const session: LoginSession = { status: "waiting", createdAt: Date.now() };
  loginSessions.set(sessionId, session);

  // Auto-cleanup after 5 minutes
  setTimeout(() => loginSessions.delete(sessionId), 300000);

  let pinCode: string | null = null;
  let pinResolver: ((pin: string) => void) | null = null;
  const pinPromise = new Promise<string>((resolve) => {
    pinResolver = resolve;
  });

  // Start login in background
  (async () => {
    try {
      const newClient = await loginWithPassword(
        {
          email,
          password,
          onPincodeRequest(pin: string) {
            console.log(`[login] PIN received: ${pin}`);
            pinCode = pin;
            if (pinResolver) pinResolver(pin);
          },
        },
        { device: "DESKTOPWIN" }
      );

      // @ts-ignore - access internal authToken
      const token = newClient.base.authToken;
      if (token) {
        LINE_AUTH_TOKEN = token;
        client = newClient;
        clientReady = true;
        session.status = "success";
        session.token = token;
        console.log(`[login] ✅ Login success, token obtained`);
      } else {
        session.status = "error";
        session.error = "No token received from loginWithPassword";
      }
    } catch (err) {
      session.status = "error";
      session.error = (err as Error).message || String(err);
      console.error(`[login] ❌ Failed: ${session.error}`);
    }
  })();

  // Wait for PIN (max 10 seconds) or session finish
  const pinResult = await Promise.race([
    pinPromise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 10000)),
  ]);

  if (pinResult) {
    return jsonResponse({
      success: true,
      needPin: true,
      pinCode: pinResult,
      sessionId,
      message: `กรุณาเปิด LINE app แล้วกด verify PIN: ${pinResult}`,
    });
  }

  // No PIN in 10s — check session status
  if (session.status === "success") {
    return jsonResponse({
      success: true,
      needPin: false,
      token: session.token,
      expiry: getTokenExpiry(),
    });
  }

  if (session.status === "error") {
    return jsonResponse({
      success: false,
      error: session.error || "Login failed",
    });
  }

  return jsonResponse({
    success: true,
    needPin: true,
    pinCode: null,
    sessionId,
    message: "รอ PIN จาก LINE...",
  });
}

async function handleLoginCheck(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session");
  if (!sessionId) return jsonResponse({ status: "error", error: "session required" }, 400);

  const session = loginSessions.get(sessionId);
  if (!session) return jsonResponse({ status: "expired", error: "Session not found" });

  if (session.status === "success" && session.token) {
    return jsonResponse({ status: "success", token: session.token, expiry: getTokenExpiry() });
  }
  if (session.status === "error") {
    return jsonResponse({ status: "error", error: session.error });
  }

  const elapsed = Math.floor((Date.now() - session.createdAt) / 1000);
  if (elapsed > 240) {
    session.status = "timeout";
    return jsonResponse({ status: "timeout", error: "ไม่ได้ verify ภายในเวลาที่กำหนด" });
  }

  return jsonResponse({ status: "waiting", elapsed, message: "รอ verify ที่ LINE app..." });
}

async function handleUpdateToken(req: Request): Promise<Response> {
  if (!checkAuth(req)) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const { token } = body;
  if (!token) return jsonResponse({ success: false, error: "token is required" }, 400);

  LINE_AUTH_TOKEN = token;
  clientReady = false;
  client = null;

  // Re-init client with new token
  try {
    await initClient();
    const expiry = getTokenExpiry();
    console.log(`[update-token] Token updated, clientReady=${clientReady}`);
    return jsonResponse({ success: clientReady, expiry, clientReady });
  } catch (err) {
    return jsonResponse({ success: false, error: (err as Error).message });
  }
}

async function handleGroups(req: Request): Promise<Response> {
  if (!checkAuth(req)) return unauthorized();

  const c = await ensureClient();
  if (!c) return jsonResponse({ success: false, error: "Client not ready" }, 500);

  try {
    // @ts-ignore - linejs internal
    const mids = await c.base.talk.getAllChatMids({ request: { withMemberChats: true, withInvitedChats: false } });
    console.log("[groups] mids:", JSON.stringify(mids).slice(0, 200));

    // @ts-ignore
    const groupIds: string[] = Array.isArray(mids?.memberChatMids) ? mids.memberChatMids : [];

    const groups: { id: string; name: string }[] = [];
    for (const gid of groupIds) {
      try {
        // @ts-ignore
        const info = await c.base.talk.getChats({ gids: [gid], withMembers: false, withInvitees: false });
        // @ts-ignore
        const name = info?.chats?.[0]?.chatName || info?.chats?.[0]?.name || "(unknown)";
        groups.push({ id: gid, name });
      } catch {
        groups.push({ id: gid, name: "(error)" });
      }
    }

    return jsonResponse({ success: true, count: groups.length, groups });
  } catch (err) {
    return jsonResponse({ success: false, error: (err as Error).message }, 500);
  }
}

async function handleSend(req: Request): Promise<Response> {
  if (!checkAuth(req)) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const { mode, to, officialTo, text, imageUrl } = body;
  if (!mode) return jsonResponse({ success: false, error: "mode is required" }, 400);

  const officialGroupId = officialTo || to;

  if (mode === "push_text") {
    if (!to || !text) return jsonResponse({ success: false, error: "push_text requires: to, text" }, 400);

    // Try unofficial first
    const result = await sendViaUnofficial(to, text);
    if (result.success) return jsonResponse(result);
    console.warn(`[send] unofficial failed: ${result.error} → fallback official`);

    // Fallback to official
    if (LINE_CHANNEL_TOKEN && officialGroupId) {
      const off = await sendViaOfficial(officialGroupId, [{ type: "text", text }]);
      return off.success ? jsonResponse(off) : jsonResponse(off, 502);
    }
    return jsonResponse({ success: false, error: result.error }, 502);
  }

  if (mode === "push_image_text") {
    if (!to || !imageUrl || !text) return jsonResponse({ success: false, error: "push_image_text requires: to, imageUrl, text" }, 400);

    // Try unofficial (text only — linejs image send is complex)
    const result = await sendViaUnofficial(to, text);
    if (result.success) return jsonResponse(result);

    // Fallback to official with image
    if (LINE_CHANNEL_TOKEN && officialGroupId) {
      const off = await sendViaOfficial(officialGroupId, [
        { type: "image", originalContentUrl: imageUrl, previewImageUrl: imageUrl },
        { type: "text", text },
      ]);
      return off.success ? jsonResponse(off) : jsonResponse(off, 502);
    }
    return jsonResponse({ success: false, error: result.error }, 502);
  }

  if (mode === "broadcast_text" || mode === "broadcast_image_text") {
    if (!LINE_CHANNEL_TOKEN) return jsonResponse({ success: false, error: "Broadcast requires official token" }, 502);

    const messages = mode === "broadcast_text"
      ? [{ type: "text", text }]
      : [
          { type: "image", originalContentUrl: imageUrl, previewImageUrl: imageUrl },
          { type: "text", text },
        ];

    try {
      const res = await fetch(`${LINE_OFFICIAL_API}/message/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINE_CHANNEL_TOKEN}` },
        body: JSON.stringify({ messages }),
      });
      return res.ok
        ? jsonResponse({ success: true, via: "official_broadcast" })
        : jsonResponse({ success: false, error: `HTTP ${res.status}` }, 502);
    } catch (err) {
      return jsonResponse({ success: false, error: (err as Error).message }, 502);
    }
  }

  return jsonResponse({ success: false, error: `unsupported mode: ${mode}` }, 400);
}

async function handleDebugSend(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const { to, text } = body;
  if (!to) return jsonResponse({ error: "to is required" }, 400);
  const testText = text || `🧪 LottoBot test ${new Date().toLocaleString("th-TH")}`;
  const result = await sendViaUnofficial(to, testText);
  return jsonResponse({
    sendResult: result,
    diagnostics: {
      to: to.slice(-8),
      toType: getMidType(to),
      toTypeLabel: ["USER", "ROOM", "GROUP"][getMidType(to)] || "UNKNOWN",
      clientReady,
      tokenStatus: getTokenExpiry(),
    },
  });
}

function handleTestPage(): Response {
  const tokenStatus = getTokenExpiry();
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LottoBot Test (Deno)</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:#1a1a2e;color:#eee;padding:16px;max-width:500px;margin:0 auto}
h2{color:#c9a84c;margin-bottom:12px}
.card{background:#16213e;border-radius:12px;padding:16px;margin-bottom:12px}
.status{display:flex;align-items:center;gap:8px;margin:6px 0}
.dot{width:10px;height:10px;border-radius:50%}
.green{background:#22a867}.red{background:#dc3545}.yellow{background:#e89b1c}
label{display:block;color:#aaa;font-size:13px;margin:8px 0 4px}
input,textarea{width:100%;padding:10px;border-radius:8px;border:1px solid #333;background:#0f3460;color:#fff;font-size:15px}
textarea{height:80px;resize:vertical}
button{width:100%;padding:12px;border:none;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;margin-top:8px}
.btn-send{background:#22a867;color:#fff}
.btn-load{background:#c9a84c;color:#000}
#result,#groups{margin-top:12px;padding:12px;border-radius:8px;font-size:14px}
.ok{background:#1b4332;border:1px solid #22a867}
.fail{background:#3d0000;border:1px solid #dc3545}
</style></head><body>
<h2>🧪 LottoBot Unofficial Test (Deno + linejs)</h2>
<div class="card">
  <div class="status"><div class="dot ${clientReady ? "green" : "red"}"></div>
    <span>Client: ${clientReady ? "✅ พร้อมใช้" : "❌ ยังไม่พร้อม"}</span></div>
  <div class="status"><div class="dot ${!tokenStatus.expired && LINE_AUTH_TOKEN ? "green" : "red"}"></div>
    <span>Token: ${!LINE_AUTH_TOKEN ? "❌ ไม่มี" : tokenStatus.expired ? "❌ หมดอายุ" : "✅ ใช้ได้"}</span></div>
</div>
<div class="card">
  <button class="btn-load" onclick="loadGroups()">📋 ดึงรายการกลุ่ม LINE</button>
  <div id="groups"></div>
</div>
<div class="card">
  <label>Group MID (to)</label>
  <input id="to" placeholder="c..." />
  <label>ข้อความ</label>
  <textarea id="text">🧪 ทดสอบ LottoBot unofficial</textarea>
  <button class="btn-send" onclick="testSend()">📤 ส่งทดสอบ</button>
  <div id="result" style="display:none"></div>
</div>
<script>
async function loadGroups() {
  const div = document.getElementById('groups')
  div.innerHTML = '⏳ กำลังดึง...'
  try {
    const res = await fetch('/groups')
    const data = await res.json()
    if (data.success && data.groups?.length > 0) {
      div.innerHTML = data.groups.map(g =>
        '<div style="background:#0f3460;padding:8px;margin:4px 0;border-radius:6px;cursor:pointer" onclick="document.getElementById(\\'to\\').value=\\''+ g.id +'\\'">' +
        '<div>' + g.name + '</div><div style="font-size:10px;color:#aaa;font-family:monospace">' + g.id + '</div></div>'
      ).join('')
    } else {
      div.innerHTML = '<div class="fail">❌ ' + (data.error || 'ไม่พบกลุ่ม') + '</div>'
    }
  } catch (e) {
    div.innerHTML = '<div class="fail">❌ ' + e.message + '</div>'
  }
}
async function testSend() {
  const to = document.getElementById('to').value.trim()
  const text = document.getElementById('text').value.trim()
  const result = document.getElementById('result')
  result.style.display = 'block'
  result.className = ''
  result.textContent = '⏳ กำลังส่ง...'
  try {
    const res = await fetch('/debug-send', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({to, text})
    })
    const data = await res.json()
    if (data.sendResult?.success) {
      result.className = 'ok'
      result.innerHTML = '✅ ส่งสำเร็จ via ' + (data.sendResult.via || 'unofficial')
    } else {
      result.className = 'fail'
      result.innerHTML = '❌ ' + (data.sendResult?.error || 'failed')
    }
  } catch (e) {
    result.className = 'fail'
    result.textContent = '❌ ' + e.message
  }
}
</script>
</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

// ─── Helpers ────────────────────────────────────────

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });
}

function unauthorized(): Response {
  return jsonResponse({ success: false, error: "Invalid auth token" }, 401);
}

// ─── Main router ────────────────────────────────────

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "Content-Type,Authorization",
      },
    });
  }

  try {
    if (path === "/health" && method === "GET") return handleHealth(req);
    if (path === "/login" && method === "POST") return handleLogin(req);
    if (path === "/login/check" && method === "GET") return handleLoginCheck(req);
    if (path === "/update-token" && method === "POST") return handleUpdateToken(req);
    if (path === "/groups" && method === "GET") return handleGroups(req);
    if (path === "/send" && method === "POST") return handleSend(req);
    if (path === "/debug-send" && method === "POST") return handleDebugSend(req);
    if (path === "/test" && method === "GET") return handleTestPage();
    return jsonResponse({ error: "Not found", path }, 404);
  } catch (err) {
    console.error(`[error] ${method} ${path}:`, (err as Error).message);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
}

// ─── Start server ───────────────────────────────────

console.log(`[unofficial-endpoint] starting on :${PORT}`);
console.log(`  mode: ${LINE_AUTH_TOKEN ? "UNOFFICIAL (primary)" : "Official only"}`);
console.log(`  unofficial token: ${LINE_AUTH_TOKEN ? "YES" : "NO"}`);
console.log(`  official token: ${LINE_CHANNEL_TOKEN ? "YES" : "NO"}`);

Deno.serve({ port: PORT }, handler);
