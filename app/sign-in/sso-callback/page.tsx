import SsoCallbackClient from "@/components/auth/SsoCallbackClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sign in · RapidMOT",
  description: "Your leads kept moving while you were away. Sign in to catch up.",
};

export default function SignInSSOCallbackPage() {
  return <SsoCallbackClient />;
}
