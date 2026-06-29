import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { clerkEnabled } from "@/lib/auth";
import { isClerkDevInstance } from "@/lib/clerk-dev";
import { mintClerkTestingToken } from "@/lib/clerk-testing-token";

/** Short-lived Clerk testing token — dev instances only; bypasses bot/CAPTCHA checks. */
export async function GET() {
  if (!clerkEnabled() || !isClerkDevInstance()) {
    return NextResponse.json({ error: "not_dev" }, { status: 403 });
  }

  const token = await mintClerkTestingToken();
  if (!token) {
    return NextResponse.json({ error: "token_failed" }, { status: 502 });
  }

  return NextResponse.json({
    token,
    expiresAt: Number(token.split("-")[0]) * 1000,
  });
}
