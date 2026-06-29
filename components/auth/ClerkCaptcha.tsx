import { shouldSkipClerkCaptcha } from "@/lib/clerk-dev-bypass";

/**
 * Clerk Smart CAPTCHA mount for custom auth flows (production).
 * On Clerk dev instances we use testing tokens instead — no widget.
 */
export default function ClerkCaptcha() {
  if (shouldSkipClerkCaptcha()) return null;

  return (
    <div
      id="clerk-captcha"
      data-cl-theme="dark"
      data-cl-size="flexible"
      className="rm-captcha"
      aria-hidden="true"
    />
  );
}
