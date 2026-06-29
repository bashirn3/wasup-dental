#!/usr/bin/env node
/**
 * Live Wasup diagnostics for Apex / freewinger77 instance.
 * Usage: node --env-file=.env.local scripts/test-wasup-apex.mjs
 */

const BASE = process.env.WASUP_BASE_URL;
const KEY = process.env.WASUP_DEPLOYMENT_API_KEY;
const INSTANCE = "51981fe4-d0f6-4801-8060-750deb57fc72";
const PHONE = "441782213131";
const TENANT = "18b506c7-70a4-4656-8ea0-3e78938cebd2";

async function call(label, url, init = {}) {
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
    /* html */
  }
  console.log(`\n=== ${label} ===`);
  console.log("HTTP", res.status);
  console.log(typeof body === "string" ? body.slice(0, 300) : JSON.stringify(body, null, 2));
  return { status: res.status, body };
}

if (!BASE || !KEY) {
  console.error("Missing WASUP_* env");
  process.exit(1);
}

console.log("Base:", BASE);
console.log("Instance:", INSTANCE);
console.log("Tenant:", TENANT);

await call("health", `${BASE}/api/health`);
await call("connection", `${BASE}/api/instances/${INSTANCE}/connection`);
await call("qr", `${BASE}/api/instances/${INSTANCE}/qr`);
await call("connect (code)", `${BASE}/api/instances/${INSTANCE}/connect`, {
  method: "POST",
  body: JSON.stringify({ pairingPhone: PHONE }),
});
await call("connect (qr)", `${BASE}/api/instances/${INSTANCE}/connect`, {
  method: "POST",
  body: JSON.stringify({}),
});
await call("onboard", `${BASE}/api/onboard`, {
  method: "POST",
  body: JSON.stringify({
    phone: PHONE,
    name: "Apex Auto and MOT Centre",
    webhookUrl: "https://rapidmot-seven.vercel.app/api/webhooks/wasup",
  }),
});

// Simulate our app's status route sequence
const conn = await call("connection (poll 1)", `${BASE}/api/instances/${INSTANCE}/connection`);
const health = await call("health (poll 1)", `${BASE}/api/health`);
console.log("\n=== App would return ===");
if (conn.status >= 500) {
  console.log("503 wasup_unavailable after 3 failed polls (~9s) → UI shows 'That didn't work'");
}
