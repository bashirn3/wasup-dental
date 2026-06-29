import SsoCallbackClient from "@/components/auth/SsoCallbackClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Create account · RapidMOT",
  description: "Every MOT lead, answered before the kettle boils.",
};

export default function SignUpSSOCallbackPage() {
  return <SsoCallbackClient />;
}
