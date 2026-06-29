import { clerkClient } from "@clerk/nextjs/server";
import { clerkEnabled } from "@/lib/auth";
import { isClerkDevInstance } from "@/lib/clerk-dev";

/** Mint a short-lived Clerk testing token (dev instances only). */
export async function mintClerkTestingToken(): Promise<string | null> {
  if (!clerkEnabled() || !isClerkDevInstance()) return null;

  try {
    const client = await clerkClient();
    const token = await client.testingTokens.createTestingToken();
    return token.token ?? null;
  } catch {
    return null;
  }
}
