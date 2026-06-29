import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const clerkEnabled =
  Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) &&
  Boolean(process.env.CLERK_SECRET_KEY);

/**
 * Protected surfaces. Public by design: "/", "/start" (sign-up happens at the
 * end of onboarding), "/api/places/search" (needed during public onboarding),
 * "/api/webhooks/*" and "/api/engine/*" (machine-to-machine, own secrets).
 */
const isProtectedPage = createRouteMatcher([
  "/dashboard(.*)",
  "/agent(.*)",
  "/connect(.*)",
]);

const isProtectedApi = createRouteMatcher([
  "/api/tenant(.*)",
  "/api/leads(.*)",
  "/api/settings(.*)",
  "/api/chats(.*)",
  "/api/bookings(.*)",
  "/api/agent(.*)",
  "/api/scan(.*)",
  "/api/wasup(.*)",
  "/api/vehicle(.*)",
  "/api/account(.*)",
  "/api/agent-config(.*)",
  "/api/dashboard-data(.*)",
  "/api/integrations(.*)",
  "/api/knowledge(.*)",
  "/api/practice(.*)",
  "/api/workflows(.*)",
  "/api/workspaces(.*)",
  // Manual "send outreach now" — must be the signed-in tenant. The cron route
  // (/api/engine/outbound) stays public and guards itself with ENGINE_SECRET.
  "/api/engine/run(.*)",
  "/api/engine/status(.*)",
]);

export default clerkEnabled
  ? clerkMiddleware(async (auth, req) => {
      if (isProtectedPage(req)) {
        const signInUrl = new URL("/sign-in", req.url);
        await auth.protect({ unauthenticatedUrl: signInUrl.toString() });
        return;
      }

      if (isProtectedApi(req)) await auth.protect();
    })
  : () => NextResponse.next();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
