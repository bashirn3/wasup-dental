import { authFontClassNames } from "@/lib/auth-fonts";

export default function AuthLoadingScreen({ label = "Signing you in…" }: { label?: string }) {
  return (
    <main
      className={`${authFontClassNames} flex min-h-dvh flex-col items-center justify-center gap-5 bg-[#0B241C] text-[#F2F5EF] [font-family:var(--font-instrument-sans),sans-serif]`}
    >
      <span className="font-[var(--font-space-grotesk)] text-lg font-bold tracking-[-0.01em]">
        Rapid<span className="text-[#C8F23C]">MOT</span>
      </span>
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-[#C8F23C]" />
      <p className="text-sm text-white/60">{label}</p>
    </main>
  );
}
