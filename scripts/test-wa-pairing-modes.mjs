#!/usr/bin/env node
/**
 * Live test: can Wasup return link code AND QR on same instance?
 * Usage: node --env-file=.env.production.local scripts/test-wa-pairing-modes.mjs
 */

const BASE = process.env.WASUP_BASE_URL;
const KEY = process.env.WASUP_DEPLOYMENT_API_KEY;
const PHONE = "447835156367";
const APP_BASE = "https://garage.wasup.co";

async function call(label, url, init = {}) {
  const started = Date.now();
  const res = await fetch(url, {
    ...init,
    headers: {
      "X-API-Key": KEY,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* raw */
  }
  const ms = Date.now() - started;
  console.log(`\n=== ${label} (${ms}ms) ===`);
  console.log("HTTP", res.status);
  if (typeof body === "string") {
    const preview = body.startsWith("data:image") ? `data:image… (${body.length} chars)` : body.slice(0, 400);
    console.log(preview);
  } else {
    const summary = { ...body };
    if (typeof summary.qrCode === "string" && summary.qrCode.length > 80) {
      summary.qrCode = `data:image… (${summary.qrCode.length} chars)`;
    }
    if (typeof summary.qr === "string" && summary.qr.length > 80) {
      summary.qr = `data:image… (${summary.qr.length} chars)`;
    }
    console.log(JSON.stringify(summary, null, 2));
  }
  return { status: res.status, body };
}

function qrFrom(body) {
  if (!body || typeof body !== "object") return null;
  for (const k of ["qrCode", "qr_code", "qr", "image", "data"]) {
    const v = body[k];
    if (typeof v === "string" && v.length > 100) return k;
  }
  return null;
}

function codeFrom(body) {
  if (!body || typeof body !== "object") return null;
  const walk = (o) => {
    if (!o || typeof o !== "object") return null;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string" && /pair|link|code/i.test(k)) {
        const clean = v.replace(/[^a-zA-Z0-9]/g, "");
        if (clean.length >= 6 && clean.length <= 12) return clean.slice(0, 8).toUpperCase();
      }
      if (v && typeof v === "object") {
        const found = walk(v);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(body);
}

if (!BASE || !KEY) {
  console.error("Missing WASUP_* env");
  process.exit(1);
}

console.log("Testing phone:", PHONE);
console.log("Base:", BASE);

// Fresh onboard
const onboard = await call("onboard", `${BASE}/api/onboard`, {
  method: "POST",
  body: JSON.stringify({
    phone: PHONE,
    name: "RapidMOT pairing test",
    webhookUrl: `${APP_BASE}/api/webhooks/wasup`,
  }),
});

const instanceId = onboard.body?.instanceId;
if (!instanceId) {
  console.error("No instanceId from onboard");
  process.exit(1);
}
console.log("\nInstance:", instanceId);

await call("connection (fresh)", `${BASE}/api/instances/${instanceId}/connection`);

// --- Scenario A: code connect first (current app flow) ---
const codeConnect = await call("A1 code connect", `${BASE}/api/instances/${instanceId}/connect`, {
  method: "POST",
  body: JSON.stringify({ phoneNumber: PHONE, pairingPhone: PHONE }),
});
const codeFromConnect = codeFrom(codeConnect.body);
console.log("→ pairing code from connect:", codeFromConnect ?? "(none)");

const qrAfterCode = await call("A2 GET /qr after code connect", `${BASE}/api/instances/${instanceId}/qr`);
console.log("→ QR field after code connect:", qrFrom(qrAfterCode.body) ?? "(none)");

// --- Scenario B: empty QR connect after code session ---
const qrConnect = await call("B1 empty QR connect", `${BASE}/api/instances/${instanceId}/connect`, {
  method: "POST",
  body: JSON.stringify({}),
});
const qrAfterEmpty = await call("B2 GET /qr after empty connect", `${BASE}/api/instances/${instanceId}/qr`);
console.log("→ QR field after empty connect:", qrFrom(qrAfterEmpty.body) ?? "(none)");
console.log("→ code still in /qr?", codeFrom(qrAfterEmpty.body) ?? "(none)");

// --- Scenario C: fresh instance QR-only (disconnect first) ---
await call("C0 disconnect", `${BASE}/api/instances/${instanceId}/disconnect`, {
  method: "POST",
  body: JSON.stringify({}),
});
await call("C0 clear-auth", `${BASE}/api/instances/${instanceId}/clear-auth`, {
  method: "POST",
  body: JSON.stringify({}),
});
await new Promise((r) => setTimeout(r, 2500));

const qrOnlyConnect = await call("C1 QR-only empty connect", `${BASE}/api/instances/${instanceId}/connect`, {
  method: "POST",
  body: JSON.stringify({}),
});

let qrOnlyImage = null;
for (let i = 0; i < 8; i++) {
  const qr = await call(`C2 GET /qr poll ${i + 1}`, `${BASE}/api/instances/${instanceId}/qr`);
  if (qr.status === 204) {
    await new Promise((r) => setTimeout(r, 700));
    continue;
  }
  const field = qrFrom(qr.body);
  if (field) {
    qrOnlyImage = field;
    break;
  }
  await new Promise((r) => setTimeout(r, 700));
}
console.log("\n=== SUMMARY ===");
console.log("Code connect returns code:", codeFromConnect ? "YES" : "NO");
console.log("GET /qr after code connect has image:", qrFrom(qrAfterCode.body) ? "YES" : "NO");
console.log("GET /qr after empty connect has image:", qrFrom(qrAfterEmpty.body) ? "YES" : "NO");
console.log("QR-only flow got image:", qrOnlyImage ? "YES" : "NO");
console.log("Mutually exclusive?", codeFromConnect && !qrFrom(qrAfterCode.body) ? "LIKELY YES" : "UNCLEAR");
