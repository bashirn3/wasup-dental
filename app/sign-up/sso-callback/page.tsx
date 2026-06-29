import SsoCallbackClient from "@/components/auth/SsoCallbackClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Create account · Wasup Dental",
  description: "Set up your dental practice workspace.",
};

export default function SignUpSSOCallbackPage() {
  return <SsoCallbackClient />;
}
