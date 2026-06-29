import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function hasAll(keys: string[]) {
  return keys.every((key) => Boolean(process.env[key]));
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    connectors: [
      {
        key: "boxly",
        label: "Boxly lanes",
        status: hasAll([
          "REGENT_LEGACY_SUPABASE_URL",
          "REGENT_LEGACY_SUPABASE_SERVICE_ROLE_KEY",
        ])
          ? "available"
          : "missing_env",
        sideEffects: "read_only_import",
      },
      {
        key: "dentally",
        label: "Dentally",
        status: hasAll(["DENTALLY_CLIENT_ID", "DENTALLY_CLIENT_SECRET"])
          ? "available"
          : "missing_env",
        sideEffects: "booking_disabled_until_approved",
      },
      {
        key: "stripe",
        label: "Stripe Connect",
        status: hasAll(["STRIPE_SECRET_KEY", "STRIPE_CONNECT_CLIENT_ID"])
          ? "available"
          : "missing_env",
        sideEffects: "payment_disabled_until_approved",
      },
      {
        key: "wasup",
        label: "Wasup",
        status: hasAll(["WASUP_BASE_URL", "WASUP_DEPLOYMENT_API_KEY"])
          ? "available"
          : "missing_env",
        sideEffects: "send_disabled_until_approved",
      },
      {
        key: "n8n",
        label: "n8n",
        status: hasAll(["N8N_BASE_URL", "N8N_API_KEY"]) ? "available" : "missing_env",
        sideEffects: "draft_only",
      },
    ],
  });
}
