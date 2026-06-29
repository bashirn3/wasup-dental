import { authFontClassNames } from "@/lib/auth-fonts";
import "../clerk-auth.css";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className={authFontClassNames}>{children}</div>;
}
