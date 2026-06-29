import type { SessionTask } from "@clerk/shared/types";

/** Where Clerk session tasks are handled in our custom auth UI. */
export const CLERK_TASK_URLS: Partial<Record<SessionTask["key"], string>> = {
  "choose-organization": "/tasks/choose-organization",
  "reset-password": "/tasks/reset-password",
  "setup-mfa": "/tasks/setup-mfa",
};

export function clerkTaskUrl(key: SessionTask["key"]): string | undefined {
  return CLERK_TASK_URLS[key];
}
