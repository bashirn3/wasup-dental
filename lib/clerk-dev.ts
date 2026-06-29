import { isDevelopmentFromPublishableKey } from "@clerk/shared/keys";

/** True when this app points at a Clerk development instance (pk_test_). */
export function isClerkDevInstance(): boolean {
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  return Boolean(pk && isDevelopmentFromPublishableKey(pk));
}
