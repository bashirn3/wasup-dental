import { NextRequest, NextResponse } from "next/server";
import { resolvePracticeMembership } from "@/lib/dental-auth";
import { resolveBoxlyBackendUrl } from "@/lib/boxly-backend";

export const dynamic = "force-dynamic";

/**
 * TEMPORARY proxy to a practice's legacy boxly-integrations backend.
 *
 * The Config tab uses this to read/write the same campaign settings the old
 * boxly dashboard manages (auto-trigger, reminders, lanes, send windows, etc.),
 * so Regent/NuYu can control their LIVE agent from wasup-dental today.
 *
 * Auth: the caller must be a member of the practice (resolvePracticeMembership),
 * so a client can only ever touch their own boxly instance. The boxly backend
 * URL never reaches the browser.
 *
 * Only an explicit allowlist of paths is forwarded. Destructive endpoints
 * (credential changes, table migration) are blocked outright.
 */

// path (without the leading "api/v1/") => methods allowed
const ALLOWLIST: Record<string, ReadonlySet<string>> = {
  // reads
  "agent/auto-config": new Set(["GET", "PUT"]),
  "agent/reminder-config": new Set(["GET", "PUT"]),
  "agent/priority-lanes": new Set(["GET", "PUT"]),
  "agent/config": new Set(["GET", "PUT"]),
  "agent/prompt-notes": new Set(["GET", "PUT"]),
  "scraper/reactivation-stages": new Set(["GET", "PUT"]),
  "scraper/config": new Set(["GET", "PUT"]),
  "scraper/status": new Set(["GET"]),
  "leads/boxes": new Set(["GET"]),
  "leads/stages": new Set(["GET"]),
  "cron": new Set(["GET", "PUT"]),
  "health": new Set(["GET"]),
  // actions (UI guards these behind an explicit confirm — they can send live messages)
  "agent/auto-trigger": new Set(["POST"]),
  "agent/reminder-run": new Set(["POST"]),
  "agent/trigger": new Set(["POST"]),
  "agent/reset-actioned": new Set(["POST"]),
  "scraper/reactivation-stages/apply": new Set(["POST"]),
  "scraper/config/reset": new Set(["POST"]),
  "scraper/quick-sync": new Set(["POST"]),
};

function isAllowed(path: string, method: string): boolean {
  const methods = ALLOWLIST[path];
  return Boolean(methods && methods.has(method));
}

async function handle(req: NextRequest, segments: string[], method: string) {
  const path = segments.join("/");

  if (!isAllowed(path, method)) {
    return NextResponse.json({ error: "path_not_allowed", path, method }, { status: 403 });
  }

  const practiceId = req.nextUrl.searchParams.get("practiceId");
  const membership = await resolvePracticeMembership(practiceId);
  if (!membership?.practiceId) {
    return NextResponse.json({ error: "practice_not_found" }, { status: 404 });
  }

  const baseUrl = await resolveBoxlyBackendUrl(membership.practiceId);
  if (!baseUrl) {
    return NextResponse.json({ error: "boxly_backend_not_configured" }, { status: 503 });
  }

  // Forward query params except our own practiceId.
  const forwarded = new URLSearchParams(req.nextUrl.searchParams);
  forwarded.delete("practiceId");
  const qs = forwarded.toString();
  const target = `${baseUrl}/api/v1/${path}${qs ? `?${qs}` : ""}`;

  const init: RequestInit = { method, headers: { "content-type": "application/json" } };
  if (method === "PUT" || method === "POST") {
    const body = await req.text();
    if (body) init.body = body;
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (error) {
    return NextResponse.json(
      { error: "boxly_backend_unreachable", detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  const contentType = upstream.headers.get("content-type") ?? "application/json";
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "content-type": contentType },
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return handle(req, path, "GET");
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return handle(req, path, "PUT");
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return handle(req, path, "POST");
}
