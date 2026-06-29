import { isClerkAPIResponseError } from "@clerk/nextjs/errors";

/** Clerk throws this when sign-up/sign-in runs while a session already exists. */
export function isAlreadySignedInError(err: unknown): boolean {
  if (isClerkAPIResponseError(err)) {
    const msg = (err.errors[0]?.longMessage ?? err.errors[0]?.message ?? "").toLowerCase();
    return (
      msg.includes("already signed in") ||
      err.errors[0]?.code === "session_exists"
    );
  }
  if (err instanceof Error) {
    return err.message.toLowerCase().includes("already signed in");
  }
  return false;
}

export function clerkErrorMessage(err: unknown, fallback: string): string {
  if (isAlreadySignedInError(err)) return "";
  if (isClerkAPIResponseError(err)) {
    return err.errors[0]?.longMessage ?? err.errors[0]?.message ?? fallback;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
