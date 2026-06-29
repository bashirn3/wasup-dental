import { NextResponse } from "next/server";
import { listAccessibleWorkspaces } from "@/lib/dental-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const workspaces = await listAccessibleWorkspaces();

  return NextResponse.json({
    ok: true,
    workspaces,
  });
}
