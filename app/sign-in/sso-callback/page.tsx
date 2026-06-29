import SsoCallbackClient from "@/components/auth/SsoCallbackClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sign in · Wasup Dental",
  description: "Open your dental workspace.",
};

export default function SignInSSOCallbackPage() {
  return <SsoCallbackClient />;
}
