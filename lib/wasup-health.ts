const BASE = process.env.WASUP_BASE_URL;
const KEY = process.env.WASUP_DEPLOYMENT_API_KEY;

export type WasupHealth = {
  ok: boolean;
  connected: number;
  total: number;
};

export function wasupConfigured(): boolean {
  return Boolean(BASE && KEY);
}

/** Lightweight deployment health — works even when per-instance routes are failing. */
export async function fetchWasupHealth(): Promise<WasupHealth | null> {
  if (!wasupConfigured()) return null;
  try {
    const res = await fetch(`${BASE}/api/health`, {
      headers: { "X-API-Key": KEY! },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return {
      ok: data.status === "ok",
      connected: Number(data.instances?.connected ?? 0),
      total: Number(data.instances?.total ?? 0),
    };
  } catch {
    return null;
  }
}

export async function wasupConnection(
  instanceId: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number }> {
  if (!wasupConfigured()) return { ok: false, status: 503 };
  const res = await fetch(`${BASE}/api/instances/${encodeURIComponent(instanceId)}/connection`, {
    headers: { "X-API-Key": KEY! },
    cache: "no-store",
  });
  if (!res.ok) return { ok: false, status: res.status };
  const data = await res.json().catch(() => ({}));
  return { ok: true, data };
}
