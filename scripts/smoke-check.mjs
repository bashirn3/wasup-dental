import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const required = [
  "app/dashboard/page.tsx",
  "components/dental/DentalApp.tsx",
  "lib/dental-dashboard-data.ts",
  "lib/dental-auth.ts",
  "lib/workflow-provisioning.ts",
  "app/api/dashboard-data/route.ts",
  "app/api/workflows/provision/route.ts",
  "app/api/import/boxly/preview/route.ts",
  "app/api/import/boxly/run/route.ts",
  "app/api/integrations/status/route.ts",
  "supabase/schema.sql",
  "n8n-workflows/drafts/dental-agent-config-read.draft.json",
];

const missing = required.filter((file) => !existsSync(join(root, file)));
if (missing.length) {
  console.error("Missing required files:");
  for (const file of missing) console.error(`- ${file}`);
  process.exit(1);
}

const provisioning = readFileSync(join(root, "lib/workflow-provisioning.ts"), "utf8");
for (const token of [
  "active: false",
  "sendAllowed: false",
  "bookingAllowed: false",
  "paymentAllowed: false",
  "crmWriteAllowed: false",
]) {
  if (!provisioning.includes(token)) {
    console.error(`Workflow safety token missing: ${token}`);
    process.exit(1);
  }
}

checkCrons();

/**
 * Every scheduled path must exist and must be reachable without a session.
 *
 * Clerk answers an unauthenticated API request with a 404 rather than a 401, so
 * a cron pointed at a protected path fails silently: Vercel records a call, the
 * handler never runs, and the only symptom is data that quietly stops updating.
 * The nightly funnel snapshot sat under /api/admin for two nights that way.
 */
function checkCrons() {
  const crons = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")).crons ?? [];
  const protectedPatterns = routeMatcherPatterns(readFileSync(join(root, "proxy.ts"), "utf8"));
  const problems = [];

  for (const { path } of crons) {
    if (!existsSync(join(root, "app", path, "route.ts"))) {
      problems.push(`${path} has no route handler at app${path}/route.ts`);
    }
    const blocking = protectedPatterns.find((pattern) => pattern.test(path));
    if (blocking) problems.push(`${path} is behind Clerk via ${blocking.source} in proxy.ts`);
  }

  if (problems.length) {
    console.error("Cron routing problems:");
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }
}

/** The path patterns passed to createRouteMatcher, as regexes. */
function routeMatcherPatterns(source) {
  return [...source.matchAll(/createRouteMatcher\(\[([\s\S]*?)\]\)/g)]
    .flatMap(([, body]) => [...body.matchAll(/"([^"]+)"/g)].map(([, pattern]) => pattern))
    .map(
      (pattern) =>
        new RegExp(
          `^${pattern
            .split("(.*)")
            .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join(".*")}$`,
        ),
    );
}

console.log("Smoke check passed: shell, dental domain, connectors, crons, and inactive workflow provisioning are present.");
