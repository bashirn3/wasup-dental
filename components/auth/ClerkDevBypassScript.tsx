import Script from "next/script";
import { parsePublishableKey } from "@clerk/shared/keys";
import { buildClerkDevBypassInitScript } from "@/lib/clerk-dev-bypass";
import { isClerkDevInstance } from "@/lib/clerk-dev";
import { mintClerkTestingToken } from "@/lib/clerk-testing-token";

/** Runs before Clerk — injects dev testing token without blocking the main thread. */
export default async function ClerkDevBypassScript() {
  if (!isClerkDevInstance()) return null;

  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const fapi = pk ? parsePublishableKey(pk)?.frontendApi : null;
  if (!fapi) return null;

  const token = await mintClerkTestingToken();

  return (
    <Script
      id="clerk-dev-bypass"
      strategy="beforeInteractive"
      dangerouslySetInnerHTML={{
        __html: buildClerkDevBypassInitScript(fapi, token ?? undefined),
      }}
    />
  );
}
