import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { clerkEnabled, currentClerkIdentity } from "@/lib/auth";
import { resolvePracticeMembership } from "@/lib/dental-auth";
import { syncClerkOrganizationName } from "@/lib/clerk-org-name";
import { syncSuperadminOrgAccess } from "@/lib/superadmin-org-access";
import type { OnboardingDraft } from "@/lib/types";

/** Compatibility endpoint for MOT shell pieces. Backed by Dental practices. */
export async function GET(req: NextRequest) {
  const supabase = supabaseAdmin();
  if (!supabase) return NextResponse.json({ tenant: null });

  const clientTenantId = req.nextUrl.searchParams.get("tenantId");
  const membership = await resolvePracticeMembership(clientTenantId);
  if (!membership?.practiceId && (clerkEnabled() || !clientTenantId)) {
    return NextResponse.json({ tenant: null });
  }

  const { data } = await supabase
    .from("practices")
    .select("id, name, location, phone, status, wasup_instance_id, connected_number")
    .eq("id", membership?.practiceId ?? clientTenantId)
    .maybeSingle();

  return NextResponse.json({
    tenant: data
      ? {
          id: data.id,
          name: data.name,
          address: data.location,
          phone: data.phone,
          onboarding_status: data.status,
          wasup_instance_id: data.wasup_instance_id,
          wasup_phone: data.connected_number,
        }
      : null,
  });
}

export async function POST(req: NextRequest) {
  const draft = (await req.json()) as OnboardingDraft;

  if (!draft.place || !Array.isArray(draft.classes) || draft.classes.length === 0) {
    return NextResponse.json({ error: "invalid_draft" }, { status: 400 });
  }

  const { userId, orgId } = await currentClerkIdentity();
  if (clerkEnabled() && !userId) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  const supabase = supabaseAdmin();
  if (!supabase) {
    // No backend configured yet (bare local dev): client keeps its localStorage copy.
    return NextResponse.json({ ok: true, storage: "local" });
  }

  const { place } = draft;
  const profile = {
    name: place.name,
    location: place.address,
    phone: place.phone,
    website_url: place.website,
    status: "draft",
    integration_mode: "native",
    source_system: "native",
    external_id: place.id,
    external_payload: {
      googlePlace: place,
      treatments: draft.classes,
      consultationFees: draft.prices,
      staffApprovalBeforeBooking: draft.freeRetest,
      tone: draft.tone,
    },
  };

  const clerkBinding = orgId ?? userId ?? null;

  // One garage per active org/account: if this context already has a tenant,
  // update it in place, even if they picked a different garage this time.
  if (userId) {
    const membership = await resolvePracticeMembership();
    if (membership?.practiceId) {
      const { error } = await supabase
        .from("practices")
        .update({
          ...profile,
          clerk_org_id: clerkBinding,
          clerk_owner_user_id: userId,
        })
        .eq("id", membership.practiceId);
      if (error) {
        console.error("practice update failed:", error);
        return NextResponse.json({ error: "save_failed" }, { status: 500 });
      }
      await Promise.all([
        syncClerkOrganizationName({ organizationId: orgId, name: place.name }),
        syncSuperadminOrgAccess({
          organizationId: orgId,
          ownerUserId: userId,
          origin: req.nextUrl.origin,
        }),
      ]);
      return NextResponse.json({ ok: true, storage: "supabase", tenantId: membership.practiceId });
    }

    // Don't let one account claim a practice another account already owns.
    const { data: existing } = await supabase
      .from("practices")
      .select("id, clerk_org_id, clerk_owner_user_id")
      .eq("source_system", "native")
      .eq("external_id", place.id)
      .maybeSingle();
    const existingIsMine =
      existing?.clerk_org_id === clerkBinding ||
      existing?.clerk_org_id === userId ||
      existing?.clerk_owner_user_id === userId;
    if (existing && (existing.clerk_org_id || existing.clerk_owner_user_id) && !existingIsMine) {
      return NextResponse.json({ error: "practice_already_claimed" }, { status: 409 });
    }
  }

  const { data, error } = await supabase
    .from("practices")
    .upsert(
      {
        ...profile,
        clerk_org_id: clerkBinding,
        clerk_owner_user_id: userId ?? null,
      },
      { onConflict: "source_system,external_id" },
    )
    .select("id")
    .single();

  if (error) {
    console.error("tenant upsert failed:", error);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  await Promise.all([
    syncClerkOrganizationName({ organizationId: orgId, name: place.name }),
    syncSuperadminOrgAccess({
      organizationId: orgId,
      ownerUserId: userId,
      origin: req.nextUrl.origin,
    }),
  ]);

  return NextResponse.json({ ok: true, storage: "supabase", tenantId: data.id });
}
