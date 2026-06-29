import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveTenantId } from "@/lib/auth";
import { deriveMotState, lookupVehicle } from "@/lib/dvla";

export type IncomingLead = {
  firstName?: string;
  lastName?: string;
  phone: string;
  registration?: string;
  motDueDate?: string | null;
  source?: "csv" | "upload" | "manual";
  status?: "queued" | "new";
  scanBatchId?: string;
  scanOrder?: number;
};

type ImportRow = {
  tenant_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string;
  registration: string;
  vehicle: string | null;
  mot_due_date: string | null;
  mot_due_source: string;
  status: "queued" | "new";
  notes: string | null;
};

function exactImportKey(row: ImportRow): string {
  return [
    row.phone.trim().toLowerCase(),
    row.registration.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""),
    (row.first_name ?? "").trim().toLowerCase(),
    (row.last_name ?? "").trim().toLowerCase(),
  ].join("|");
}

function dropExactImportDuplicates(rows: ImportRow[]): { rows: ImportRow[]; skipped: number } {
  const seen = new Set<string>();
  const deduped: ImportRow[] = [];

  for (const row of rows) {
    const key = exactImportKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }

  return { rows: deduped, skipped: rows.length - deduped.length };
}

export async function GET(req: NextRequest) {
  const tenantId = await resolveTenantId(req.nextUrl.searchParams.get("tenantId"));
  if (!tenantId) return NextResponse.json({ error: "missing_tenant" }, { status: 400 });

  const supabase = supabaseAdmin();
  if (!supabase) return NextResponse.json({ leads: [], storage: "none" });

  const { data, error } = await supabase
    .from("leads")
    .select(
      "id, first_name, last_name, phone, registration, vehicle, mot_due_date, mot_due_source, status, notes, created_at",
    )
    .eq("tenant_id", tenantId)
    .order("mot_due_date", { ascending: true, nullsFirst: false })
    .limit(1000);

  if (error) {
    console.error("leads list failed:", error);
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }
  return NextResponse.json({ leads: data });
}

/** Batch import. Enriches rows that have a registration via DVLA (best effort). */
export async function POST(req: NextRequest) {
  const { tenantId: clientTenantId, leads, enrich } = (await req.json()) as {
    tenantId?: string;
    leads?: IncomingLead[];
    enrich?: boolean;
  };

  const tenantId = await resolveTenantId(clientTenantId);
  if (!tenantId || !Array.isArray(leads) || leads.length === 0) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (leads.length > 2000) {
    return NextResponse.json({ error: "too_many_rows" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "no_storage" }, { status: 503 });

  // DVLA enrichment with small concurrency; never blocks the import on failure.
  const enriched = new Map<string, { due: string | null; vehicle: string | null }>();
  if (enrich !== false) {
    const regs = [...new Set(leads.map((l) => l.registration).filter(Boolean))] as string[];
    const queue = [...regs];
    const workers = Array.from({ length: 5 }, async () => {
      while (queue.length > 0) {
        const reg = queue.shift()!;
        try {
          const v = await lookupVehicle(reg);
          const mot = deriveMotState(v);
          enriched.set(reg, {
            due: mot.motExpiryDate,
            vehicle: [mot.colour, mot.make].filter(Boolean).join(" ") || null,
          });
        } catch {
          /* keep the CSV value */
        }
      }
    });
    await Promise.all(workers);
  }

  const rows: ImportRow[] = leads.map((l) => {
    const reg = l.registration ?? "";
    const hit = reg ? enriched.get(reg) : undefined;
    return {
      tenant_id: tenantId,
      first_name: l.firstName ?? null,
      last_name: l.lastName ?? null,
      phone: l.phone,
      registration: reg,
      vehicle: hit?.vehicle ?? null,
      mot_due_date: hit?.due ?? l.motDueDate ?? null,
      mot_due_source: hit?.due ? "api" : l.source ?? "csv",
      status: l.status === "new" ? "new" : "queued",
      notes:
        l.source === "upload" && l.scanBatchId && typeof l.scanOrder === "number"
          ? JSON.stringify({ scanBatchId: l.scanBatchId, scanOrder: l.scanOrder })
          : null,
    };
  });
  const deduped = dropExactImportDuplicates(rows);

  if (deduped.rows.length === 0) {
    return NextResponse.json({
      ok: true,
      inserted: 0,
      skippedDuplicates: rows.length,
      skippedInputDuplicates: deduped.skipped,
      enriched: enriched.size,
    });
  }

  const { data, error } = await supabase
    .from("leads")
    .upsert(deduped.rows, {
      onConflict: "tenant_id,phone,registration",
      ignoreDuplicates: true,
    })
    .select("id");

  if (error) {
    console.error("leads import failed:", error);
    return NextResponse.json({ error: "import_failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    inserted: data?.length ?? 0,
    skippedDuplicates: rows.length - (data?.length ?? 0),
    skippedInputDuplicates: deduped.skipped,
    enriched: enriched.size,
  });
}

export async function PATCH(req: NextRequest) {
  const { tenantId: clientTenantId, ids, action, fields } = (await req.json()) as {
    tenantId?: string;
    ids?: string[];
    action?: "approve" | "reject" | "update" | "delete";
    fields?: {
      firstName?: string | null;
      lastName?: string | null;
      phone?: string;
      registration?: string;
      vehicle?: string | null;
      motDueDate?: string | null;
    };
  };
  const tenantId = await resolveTenantId(clientTenantId);
  if (!tenantId || !Array.isArray(ids) || ids.length === 0 || !action) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "no_storage" }, { status: 503 });

  if (action === "delete") {
    const { data, error } = await supabase
      .from("leads")
      .delete()
      .eq("tenant_id", tenantId)
      .in("id", ids)
      .select("id");

    if (error) {
      console.error("lead delete failed:", error);
      return NextResponse.json({ error: "delete_failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, deleted: data?.length ?? 0 });
  }

  let update: Record<string, unknown>;
  if (action === "update") {
    if (!fields) return NextResponse.json({ error: "missing_fields" }, { status: 400 });
    update = {
      updated_at: new Date().toISOString(),
      ...(fields.firstName !== undefined ? { first_name: fields.firstName } : {}),
      ...(fields.lastName !== undefined ? { last_name: fields.lastName } : {}),
      ...(fields.phone !== undefined ? { phone: fields.phone } : {}),
      ...(fields.registration !== undefined ? { registration: fields.registration } : {}),
      ...(fields.vehicle !== undefined ? { vehicle: fields.vehicle } : {}),
      ...(fields.motDueDate !== undefined
        ? { mot_due_date: fields.motDueDate, mot_due_source: "api" }
        : {}),
    };
  } else {
    update =
      action === "approve"
        ? { status: "new", updated_at: new Date().toISOString() }
        : { status: "invalid", updated_at: new Date().toISOString() };
  }

  const { data, error } = await supabase
    .from("leads")
    .update(update)
    .eq("tenant_id", tenantId)
    .in("id", ids)
    .select("id");

  if (error) {
    console.error("lead bulk update failed:", error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: data?.length ?? 0 });
}
