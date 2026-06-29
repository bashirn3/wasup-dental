import { authFontClassNames } from "@/lib/auth-fonts";

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return <div className={authFontClassNames}>{children}</div>;
}
