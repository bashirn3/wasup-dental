import { auth, currentUser } from "@clerk/nextjs/server";
import { clerkEnabled } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import type { DentalWorkspace, Role, SourceSystem } from "@/lib/dental-types";

type MembershipRow = {
  practice_id: string;
  role: Role;
};

type PracticeRow = {
  id: string;
  name?: string;
  source_system?: SourceSystem | null;
  integration_mode?: string | null;
};

type SupabaseResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

export type PracticeMembership = {
  practiceId: string;
  role: Role;
  email: string | null;
  isInternalAdmin: boolean;
};

const INTERNAL_ADMIN_EMAILS = new Set(
  (process.env.INTERNAL_ADMIN_EMAILS ?? "bashir@tryrapidscreen.com,arslan@tryrapidscreen.com")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

async function currentIdentity() {
  if (!clerkEnabled()) return { userId: null, orgId: null, email: null };

  const session = await auth();
  const user = await currentUser();
  const email =
    user?.primaryEmailAddress?.emailAddress?.toLowerCase() ??
    (typeof session.sessionClaims?.email === "string"
      ? session.sessionClaims.email.toLowerCase()
      : null);

  return {
    userId: session.userId ?? null,
    orgId: session.orgId ?? null,
    email,
  };
}

function membership(practiceId: string, role: Role, email: string | null, isInternalAdmin: boolean): PracticeMembership {
  return { practiceId, role, email, isInternalAdmin };
}

/** Email of the currently signed-in Clerk user (lowercased), or null. */
export async function getSignedInEmail(): Promise<string | null> {
  const { email } = await currentIdentity();
  return email;
}

export async function resolvePracticeMembership(
  requestedPracticeId?: string | null,
): Promise<PracticeMembership | null> {
  const supabase = supabaseAdmin();
  if (!supabase) {
    return requestedPracticeId
      ? membership(requestedPracticeId, "admin", null, true)
      : membership("mock-practice", "admin", null, true);
  }

  if (!clerkEnabled()) {
    if (requestedPracticeId) return membership(requestedPracticeId, "admin", null, true);

    const { data } = (await supabase
      .from("practices")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()) as SupabaseResult<PracticeRow>;

    return data?.id ? membership(data.id, "admin", null, true) : null;
  }

  const { userId, orgId, email } = await currentIdentity();
  if (!userId) return null;
  const isInternalAdmin = Boolean(email && INTERNAL_ADMIN_EMAILS.has(email));

  if (isInternalAdmin && requestedPracticeId) {
    const { data } = (await supabase
      .from("practices")
      .select("id")
      .eq("id", requestedPracticeId)
      .maybeSingle()) as SupabaseResult<PracticeRow>;
    return data?.id ? membership(data.id, "admin", email, true) : null;
  }

  if (requestedPracticeId) {
    const { data: byUser } = (await supabase
      .from("memberships")
      .select("practice_id, role")
      .eq("practice_id", requestedPracticeId)
      .eq("clerk_user_id", userId)
      .maybeSingle()) as SupabaseResult<MembershipRow>;
    if (byUser) return membership(byUser.practice_id, byUser.role, email, isInternalAdmin);

    if (email) {
      const byEmail = (await supabase
        .from("memberships")
        .select("practice_id, role")
        .eq("practice_id", requestedPracticeId)
        .ilike("email", email)
        .maybeSingle()) as SupabaseResult<MembershipRow>;
      if (byEmail.data) return membership(byEmail.data.practice_id, byEmail.data.role, email, isInternalAdmin);
    }

    return null;
  }

  if (orgId) {
    const { data } = (await supabase
      .from("practices")
      .select("id")
      .eq("clerk_org_id", orgId)
      .limit(1)
      .maybeSingle()) as SupabaseResult<PracticeRow>;
    if (data?.id) return membership(data.id, "admin", email, isInternalAdmin);
  }

  const byUser = (await supabase
    .from("memberships")
    .select("practice_id, role")
    .eq("clerk_user_id", userId)
    .limit(1)
    .maybeSingle()) as SupabaseResult<MembershipRow>;
  if (byUser.data) return membership(byUser.data.practice_id, byUser.data.role, email, isInternalAdmin);

  if (email) {
    const byEmail = (await supabase
      .from("memberships")
      .select("practice_id, role")
      .ilike("email", email)
      .limit(1)
      .maybeSingle()) as SupabaseResult<MembershipRow>;
    if (byEmail.data) return membership(byEmail.data.practice_id, byEmail.data.role, email, isInternalAdmin);
  }

  if (isInternalAdmin) {
    const { data } = (await supabase
      .from("practices")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()) as SupabaseResult<PracticeRow>;
    if (data?.id) return membership(data.id, "admin", email, true);
  }

  return null;
}

export async function listAccessibleWorkspaces(): Promise<DentalWorkspace[]> {
  const supabase = supabaseAdmin();
  if (!supabase) {
    return [
      {
        id: "mock-practice",
        name: "Regent Dental",
        role: "admin",
        sourceSystem: "regent",
        integrationMode: "legacy_mirror",
      },
    ];
  }

  if (!clerkEnabled()) {
    const { data } = (await supabase
      .from("practices")
      .select("id, name, source_system, integration_mode")
      .order("name", { ascending: true })) as SupabaseResult<PracticeRow[]>;
    return (data ?? []).map((practice) => mapWorkspace(practice, "admin"));
  }

  const { userId, email } = await currentIdentity();
  if (!userId) return [];
  const isInternalAdmin = Boolean(email && INTERNAL_ADMIN_EMAILS.has(email));

  if (isInternalAdmin) {
    const { data } = (await supabase
      .from("practices")
      .select("id, name, source_system, integration_mode")
      .order("name", { ascending: true })) as SupabaseResult<PracticeRow[]>;
    return (data ?? []).map((practice) => mapWorkspace(practice, "admin"));
  }

  let query = supabase
    .from("memberships")
    .select("practice_id, role, practices(id, name, source_system, integration_mode)");

  if (email) {
    query = query.or(`clerk_user_id.eq.${userId},email.ilike.${email}`);
  } else {
    query = query.eq("clerk_user_id", userId);
  }

  const { data } = (await query) as SupabaseResult<
    Array<MembershipRow & { practices: PracticeRow | null }>
  >;

  const seen = new Set<string>();
  const workspaces: DentalWorkspace[] = [];
  for (const row of data ?? []) {
    if (!row.practices || seen.has(row.practice_id)) continue;
    seen.add(row.practice_id);
    workspaces.push(mapWorkspace(row.practices, row.role));
  }

  return workspaces;
}

function mapWorkspace(practice: PracticeRow, role: Role): DentalWorkspace {
  return {
    id: practice.id,
    name: practice.name ?? "Practice",
    role,
    sourceSystem: practice.source_system ?? "native",
    integrationMode: practice.integration_mode ?? "native",
  };
}
