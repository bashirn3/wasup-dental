import { supabaseAdmin } from "@/lib/supabase";

/**
 * TEMPORARY bridge to the legacy boxly-integrations backend.
 *
 * Until wasup-dental becomes the real orchestrator (own outbound engine + n8n
 * overlay), the Config tab lets Regent/NuYu control their LIVE agent by talking
 * to their existing boxly backend deployment, which already feeds n8n. This file
 * resolves a practice -> the correct boxly backend base URL.
 *
 * Resolution order:
 *   1. integrations.settings.boxlyBackendUrl (per-practice, data-driven)
 *   2. env override BOXLY_BACKEND_URL_<EXTERNAL_ID>  (e.g. BOXLY_BACKEND_URL_REGENT_BOXLY)
 *   3. hardcoded fallback by practices.external_id
 *
 * Rip this whole module out once the native orchestrator lands.
 */

const FALLBACK_BY_EXTERNAL_ID: Record<string, string> = {
  "regent-boxly": "https://boxly-agent.vercel.app",
  "nuyu-boxly": "https://nuyu-boxly-agent-lyart.vercel.app",
};

type SupabaseResult<T> = {
  data: T | null;
  error: { code?: string; message: string } | null;
};

type PracticeRow = { id: string; external_id: string | null };
type IntegrationRow = { settings: Record<string, unknown> | null };

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function envOverride(externalId: string | null): string | null {
  if (!externalId) return null;
  const envKey = `BOXLY_BACKEND_URL_${externalId.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}`;
  const value = process.env[envKey];
  return value ? normalizeBase(value) : null;
}

export async function resolveBoxlyBackendUrl(practiceId: string): Promise<string | null> {
  const supabase = supabaseAdmin();
  if (!supabase) return null;

  const { data: practice } = (await supabase
    .from("practices")
    .select("id, external_id")
    .eq("id", practiceId)
    .maybeSingle()) as SupabaseResult<PracticeRow>;

  if (!practice?.id) return null;

  const { data: integration } = (await supabase
    .from("integrations")
    .select("settings")
    .eq("practice_id", practiceId)
    .eq("source_system", "boxly")
    .maybeSingle()) as SupabaseResult<IntegrationRow>;

  const fromSettings = integration?.settings?.boxlyBackendUrl;
  if (typeof fromSettings === "string" && fromSettings.trim()) {
    return normalizeBase(fromSettings);
  }

  const fromEnv = envOverride(practice.external_id);
  if (fromEnv) return fromEnv;

  const fallback = practice.external_id ? FALLBACK_BY_EXTERNAL_ID[practice.external_id] : null;
  return fallback ? normalizeBase(fallback) : null;
}
