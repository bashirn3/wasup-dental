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

console.log("Smoke check passed: shell, dental domain, connectors, and inactive workflow provisioning are present.");
