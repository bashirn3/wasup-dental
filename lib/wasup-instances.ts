import { normalizeWasupPhone } from "@/lib/wa-tenant";

const BASE = process.env.WASUP_BASE_URL;
const DEPLOYMENT_KEY = process.env.WASUP_DEPLOYMENT_API_KEY;

const PREP_SLEEP_MS = 2000;
const CONNECTION_CLOSED_RETRY_MS = 4000;

type WasupFetchResult = {
  ok: boolean;
  status: number;
  body: string;
};

export type WasupLinkMode = "qr" | "code";

export type WasupPairingPayload = {
  qrCode: string | null;
  pairingCode: string | null;
  status?: string;
  phone?: string | null;
  reused?: boolean;
};

function normalizeQrCode(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return value.startsWith("data:image/") ? value : `data:image/png;base64,${value}`;
}

function qrCodeFromJson(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  for (const key of ["qrCode", "qr_code", "qr", "image", "data"] as const) {
    const code = normalizeQrCode(record[key]);
    if (code) return code;
  }
  return null;
}

function looksLikeLinkCode(value: string): string | null {
  const clean = value.replace(/[^a-zA-Z0-9]/g, "");
  if (clean.length >= 6 && clean.length <= 12) return clean.slice(0, 8).toUpperCase();
  return null;
}

/** Wasup workers have used several keys (and nestings) for the 8-char link code. */
export function pairingCodeFromPayload(data: unknown): string | null {
  if (data == null) return null;
  if (typeof data === "string") return looksLikeLinkCode(data);
  if (typeof data !== "object") return null;

  const queue: unknown[] = [data];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur == null || typeof cur !== "object") continue;
    if (seen.has(cur)) continue;
    seen.add(cur);

    if (Array.isArray(cur)) {
      for (const item of cur) queue.push(item);
      continue;
    }

    for (const [key, value] of Object.entries(cur as Record<string, unknown>)) {
      if (typeof value === "string" && /pair|link|code/i.test(key)) {
        const code = looksLikeLinkCode(value);
        if (code) return code;
      } else if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }

  // Fallback: first standalone 8-char alphanumeric anywhere in the tree.
  const fallback: unknown[] = [data];
  const seenFallback = new Set<unknown>();
  while (fallback.length > 0) {
    const cur = fallback.shift();
    if (cur == null || typeof cur !== "object") continue;
    if (seenFallback.has(cur)) continue;
    seenFallback.add(cur);
    if (Array.isArray(cur)) {
      for (const item of cur) fallback.push(item);
      continue;
    }
    for (const value of Object.values(cur as Record<string, unknown>)) {
      if (typeof value === "string") {
        const clean = value.replace(/[^a-zA-Z0-9]/g, "");
        if (/^[A-Z0-9]{8}$/i.test(clean)) return clean.toUpperCase();
      } else if (value && typeof value === "object") {
        fallback.push(value);
      }
    }
  }

  return null;
}

function pairingCodeFromJson(data: unknown): string | null {
  return pairingCodeFromPayload(data);
}

export type WasupDisconnectSteps = {
  disconnect: boolean;
  clearAuth: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Docs: deployment `X-API-Key` for admin, or per-instance `wsp_v3_*` for scoped calls. */
function authHeaders(instanceApiKey?: string | null): Record<string, string>[] {
  const headers: Record<string, string>[] = [];
  if (DEPLOYMENT_KEY) {
    headers.push({ "X-API-Key": DEPLOYMENT_KEY, "Content-Type": "application/json" });
  }
  const instanceKey = instanceApiKey?.trim();
  if (instanceKey) {
    headers.push({ "X-API-Key": instanceKey, "Content-Type": "application/json" });
  }
  return headers;
}

export function wasupInstancesConfigured(): boolean {
  return Boolean(BASE && DEPLOYMENT_KEY);
}

async function wasupFetch(
  path: string,
  init: RequestInit & { instanceApiKey?: string | null } = {},
): Promise<WasupFetchResult> {
  if (!BASE) return { ok: false, status: 503, body: "wasup_not_configured" };

  const { instanceApiKey, ...requestInit } = init;
  const method = requestInit.method ?? "GET";
  let lastRetryable: WasupFetchResult | null = null;

  for (const headers of authHeaders(instanceApiKey)) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        ...requestInit,
        method,
        headers: { ...headers, ...(requestInit.headers as Record<string, string> | undefined) },
        body: requestInit.body,
        cache: "no-store",
      });
      const text = await res.text().catch(() => "");
      if (res.ok) return { ok: true, status: res.status, body: text };
      if (res.status === 401 || res.status === 404) {
        lastRetryable = { ok: false, status: res.status, body: text };
        continue;
      }
      if (res.status >= 500) {
        lastRetryable = { ok: false, status: res.status, body: text };
        continue;
      }
      return { ok: false, status: res.status, body: text };
    } catch {
      /* try next auth header */
    }
  }

  if (lastRetryable) return lastRetryable;
  return { ok: false, status: 502, body: "wasup_unreachable" };
}

function isInstanceNotFound(res: WasupFetchResult): boolean {
  if (res.status === 404) return true;
  const lower = res.body.toLowerCase();
  return lower.includes("instance not found") || lower.includes('"error":"not found"');
}

function isConnectionClosed(res: WasupFetchResult): boolean {
  if (res.status === 428) return true;
  const lower = res.body.toLowerCase();
  return lower.includes("connection closed");
}

/** Check whether an instance still exists on the Wasup worker. */
export async function checkWasupInstance(
  instanceId: string,
  instanceApiKey?: string | null,
): Promise<"live" | "missing" | "error"> {
  const res = await wasupFetch(`/api/instances/${encodeURIComponent(instanceId)}/connection`, {
    instanceApiKey,
  });
  if (res.ok) return "live";
  if (isInstanceNotFound(res)) return "missing";
  return "error";
}

async function postInstanceAction(
  instanceId: string,
  action: "disconnect" | "clear-auth",
  instanceApiKey?: string | null,
): Promise<WasupFetchResult> {
  return wasupFetch(`/api/instances/${encodeURIComponent(instanceId)}/${action}`, {
    method: "POST",
    body: JSON.stringify({}),
    instanceApiKey,
  });
}

export async function wasupConnectionStatus(
  instanceId: string,
  instanceApiKey?: string | null,
): Promise<{
  ok: boolean;
  status: string;
  phone: string | null;
  httpStatus: number;
  missing?: boolean;
}> {
  const res = await wasupFetch(`/api/instances/${encodeURIComponent(instanceId)}/connection`, {
    instanceApiKey,
  });
  if (!res.ok) {
    return {
      ok: false,
      status: "disconnected",
      phone: null,
      httpStatus: res.status,
      missing: isInstanceNotFound(res),
    };
  }
  try {
    const data = JSON.parse(res.body) as { status?: string; phone?: string | null };
    return {
      ok: true,
      status: String(data.status ?? "disconnected"),
      phone: data.phone ?? null,
      httpStatus: res.status,
    };
  } catch {
    return { ok: false, status: "disconnected", phone: null, httpStatus: res.status };
  }
}

/**
 * Bulletproof prep before minting a new pairing code:
 * disconnect → clear-auth → wait ~2s so stale creds are gone.
 */
export async function prepareWasupInstanceForPairing(
  instanceId: string,
  instanceApiKey?: string | null,
): Promise<WasupDisconnectSteps> {
  const disconnect = await postInstanceAction(instanceId, "disconnect", instanceApiKey);
  const clearAuth = await postInstanceAction(instanceId, "clear-auth", instanceApiKey);
  await sleep(PREP_SLEEP_MS);
  return {
    disconnect: disconnect.ok,
    clearAuth: clearAuth.ok,
  };
}

/**
 * Full Wasup logout per docs — always runs BOTH steps in order:
 * 1. POST /api/instances/{id}/disconnect
 * 2. POST /api/instances/{id}/clear-auth
 */
export async function disconnectWasupSession(
  instanceId: string,
  instanceApiKey?: string | null,
): Promise<{ ok: boolean; status: number; detail: string; steps: WasupDisconnectSteps }> {
  const steps = await prepareWasupInstanceForPairing(instanceId, instanceApiKey);

  if (!steps.disconnect || !steps.clearAuth) {
    const failed = !steps.disconnect ? "disconnect" : "clear-auth";
    return {
      ok: false,
      status: 502,
      detail: `${failed}_failed`,
      steps,
    };
  }

  const conn = await wasupConnectionStatus(instanceId, instanceApiKey);
  if (conn.ok && conn.status === "connected") {
    return { ok: false, status: 409, detail: "still_connected", steps };
  }

  return { ok: true, status: 200, detail: "disconnected", steps };
}

/** @deprecated use disconnectWasupSession */
export const clearWasupAuth = disconnectWasupSession;

/** Permanently remove an instance — disconnect + clear-auth first, then one DELETE. */
export async function deleteWasupInstance(
  instanceId: string,
  instanceApiKey?: string | null,
): Promise<{ ok: boolean; status: number; detail: string; steps?: WasupDisconnectSteps }> {
  const session = await disconnectWasupSession(instanceId, instanceApiKey);

  const del = await wasupFetch(`/api/instances/${encodeURIComponent(instanceId)}`, {
    method: "DELETE",
    instanceApiKey,
  });

  if (del.ok || isInstanceNotFound(del)) {
    return {
      ok: true,
      status: del.status || 200,
      detail: del.ok ? "deleted" : "already_gone",
      steps: session.steps,
    };
  }

  if (!session.ok) {
    return { ok: false, status: session.status, detail: session.detail, steps: session.steps };
  }

  return { ok: false, status: del.status, detail: `delete_failed: ${del.body.slice(0, 120)}`, steps: session.steps };
}

type ConnectResult = WasupFetchResult & {
  pairingCode?: string | null;
  instanceStatus?: string;
  instancePhone?: string | null;
  reused?: boolean;
};

async function postConnect(
  instanceId: string,
  mode: WasupLinkMode,
  phone?: string,
  instanceApiKey?: string | null,
): Promise<ConnectResult> {
  const pairingPhone = phone?.trim() ? normalizeWasupPhone(phone) : "";
  // Wasup: QR needs empty POST /connect; link code needs { pairingPhone }.
  const body =
    mode === "code" && pairingPhone
      ? JSON.stringify({ phoneNumber: pairingPhone, pairingPhone })
      : JSON.stringify({});

  const res = await wasupFetch(`/api/instances/${encodeURIComponent(instanceId)}/connect`, {
    method: "POST",
    body,
    instanceApiKey,
  });

  if (!res.ok) return res;

  try {
    const data = JSON.parse(res.body);
    return {
      ...res,
      pairingCode: pairingCodeFromJson(data),
      reused: (data as { reused?: boolean }).reused === true,
      instanceStatus:
        (data as { instance?: { status?: string } }).instance?.status ??
        (data as { status?: string }).status,
      instancePhone:
        (data as { instance?: { phone?: string | null } }).instance?.phone ??
        (data as { phone?: string | null }).phone ??
        null,
    };
  } catch {
    return res;
  }
}

/** One connect per attempt; retry once after 4s on Connection Closed. */
async function connectWithRetry(
  instanceId: string,
  mode: WasupLinkMode,
  phone?: string,
  instanceApiKey?: string | null,
): Promise<ConnectResult> {
  let connect = await postConnect(instanceId, mode, phone, instanceApiKey);
  if (!connect.ok && isConnectionClosed(connect)) {
    await sleep(CONNECTION_CLOSED_RETRY_MS);
    connect = await postConnect(instanceId, mode, phone, instanceApiKey);
  }
  return connect;
}

async function getQrPayload(
  instanceId: string,
  instanceApiKey?: string | null,
  maxAttempts = 3,
): Promise<WasupPairingPayload | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await wasupFetch(`/api/instances/${encodeURIComponent(instanceId)}/qr`, {
      instanceApiKey,
    });
    if (res.status === 204) {
      await sleep(700);
      continue;
    }
    if (!res.ok) return null;
    try {
      const qr = JSON.parse(res.body);
      return {
        qrCode: qrCodeFromJson(qr),
        pairingCode: pairingCodeFromJson(qr),
        status: (qr as { status?: string }).status,
        phone: (qr as { phone?: string | null }).phone ?? null,
      };
    } catch {
      const raw = res.body.trim();
      const direct = normalizeQrCode(raw);
      if (direct) {
        return { qrCode: direct, pairingCode: null };
      }
      return null;
    }
  }
  return null;
}

/** POST /connect (code mode) then read pairing code from response or GET /qr. */
export async function fetchWasupLinkCode(
  instanceId: string,
  options: {
    phone?: string;
    instanceApiKey?: string | null;
  },
): Promise<string | null> {
  const { phone, instanceApiKey } = options;

  const connect = await connectWithRetry(instanceId, "code", phone, instanceApiKey);
  if (connect.pairingCode) return connect.pairingCode;

  const payload = await getQrPayload(instanceId, instanceApiKey, 5);
  if (payload?.pairingCode) return payload.pairingCode;

  return null;
}

/** Empty-body QR connect then poll GET /qr for the scan image. */
export async function fetchWasupQrImage(
  instanceId: string,
  options: {
    instanceApiKey?: string | null;
    maxQrAttempts?: number;
  } = {},
): Promise<string | null> {
  const { instanceApiKey, maxQrAttempts = 12 } = options;

  const connect = await connectWithRetry(instanceId, "qr", undefined, instanceApiKey);
  if (!connect.ok) return null;

  const payload = await getQrPayload(instanceId, instanceApiKey, maxQrAttempts);
  return payload?.qrCode ?? null;
}

/**
 * Bulletproof pairing start: disconnect → clear-auth → wait → one POST /connect.
 * Use skipPrep only for a brand-new instance that has never been paired.
 */
export async function startWasupPairingSession(
  instanceId: string,
  options: {
    mode: WasupLinkMode;
    phone?: string;
    instanceApiKey?: string | null;
    skipPrep?: boolean;
  },
): Promise<WasupPairingPayload> {
  const { mode, phone, instanceApiKey, skipPrep = false } = options;

  if (!skipPrep) {
    await prepareWasupInstanceForPairing(instanceId, instanceApiKey);
  }

  const connect = await connectWithRetry(instanceId, mode, phone, instanceApiKey);

  if (!connect.ok) {
    return { qrCode: null, pairingCode: null, status: "disconnected" };
  }

  if (mode === "code" && connect.pairingCode) {
    return {
      qrCode: null,
      pairingCode: connect.pairingCode,
      status: connect.instanceStatus ?? "connecting",
      phone: connect.instancePhone ?? null,
      reused: connect.reused,
    };
  }

  const payload = await getQrPayload(instanceId, instanceApiKey);
  if (payload) {
    return {
      ...payload,
      pairingCode: payload.pairingCode ?? connect.pairingCode ?? null,
      status: payload.status ?? connect.instanceStatus ?? "connecting",
      phone: payload.phone ?? connect.instancePhone ?? null,
      reused: connect.reused,
    };
  }

  return {
    qrCode: null,
    pairingCode: connect.pairingCode ?? null,
    status: connect.instanceStatus ?? "connecting",
    phone: connect.instancePhone ?? null,
    reused: connect.reused,
  };
}

/** Start or refresh a Wasup pairing session (QR scan or phone link code). */
export async function fetchWasupPairingPayload(
  instanceId: string,
  options: {
    mode: WasupLinkMode;
    phone?: string;
    instanceApiKey?: string | null;
    /** Clear auth and restart QR when refreshing an expired code. */
    forceRefresh?: boolean;
    /** POST /connect before reading QR/code. Off for passive polls. */
    restartSession?: boolean;
    /** Skip disconnect+clear-auth for a freshly provisioned instance. */
    skipPrep?: boolean;
  },
): Promise<WasupPairingPayload> {
  const { mode, phone, instanceApiKey, restartSession = true, skipPrep = false } = options;

  if (!restartSession) {
    return readWasupPairingSnapshot(instanceId, instanceApiKey);
  }

  return startWasupPairingSession(instanceId, {
    mode,
    phone,
    instanceApiKey,
    skipPrep,
  });
}

/** Read current QR/code without restarting the pairing session (GET only). */
export async function readWasupPairingSnapshot(
  instanceId: string,
  instanceApiKey?: string | null,
  options?: { waitForQr?: boolean },
): Promise<WasupPairingPayload> {
  const conn = await wasupConnectionStatus(instanceId, instanceApiKey);
  if (conn.ok && conn.status === "connected") {
    return {
      qrCode: null,
      pairingCode: null,
      status: "connected",
      phone: conn.phone,
    };
  }

  const qrAttempts = options?.waitForQr ? 10 : 3;
  const qr = (await getQrPayload(instanceId, instanceApiKey, qrAttempts)) ?? {
    qrCode: null,
    pairingCode: null,
  };
  return {
    qrCode: qr.qrCode,
    pairingCode: qr.pairingCode,
    status: qr.status ?? (conn.ok ? conn.status : "disconnected"),
    phone: qr.phone ?? (conn.ok ? conn.phone : null),
  };
}
