/** Shared Clerk appearance — modals only; auth pages use headless custom UI. */
export const clerkAppearance = {
  layout: {
    socialButtonsPlacement: "top" as const,
    socialButtonsVariant: "blockButton" as const,
    logoPlacement: "none" as const,
  },
  variables: {
    colorPrimary: "#11342B",
    colorText: "#11342B",
    colorTextSecondary: "#6B7A70",
    colorBackground: "#FFFFFF",
    colorInputBackground: "#F8F7F2",
    colorInputText: "#11342B",
    colorDanger: "#b42318",
    borderRadius: "12px",
    fontFamily: "var(--font-instrument-sans), system-ui, sans-serif",
    spacingUnit: "1rem",
  },
  elements: {
    modalBackdrop: "bg-[#0B241C]/80 backdrop-blur-sm",
    modalContent:
      "rounded-3xl border border-[#E7E5DA] bg-white shadow-[0_24px_80px_-24px_rgba(11,36,28,0.35)]",
    rootBox: "w-full",
    card: "shadow-none bg-transparent gap-5 p-0 w-full",
    cardBox: "shadow-none bg-transparent",
    headerTitle: "font-[family-name:var(--font-space-grotesk)] text-xl font-semibold text-[#11342B]",
    headerSubtitle: "text-sm text-[#6B7A70]",
    socialButtonsBlockButton:
      "rounded-xl border border-[#E7E5DA] bg-[#F4F3EC] hover:bg-[#EDECE4] text-[#11342B] font-medium py-3 min-h-[48px]",
    formFieldInput:
      "rounded-xl bg-[#F8F7F2] border border-[#E7E5DA] text-[#11342B] py-3 px-4 min-h-[48px] focus:border-[#11342B] focus:ring-2 focus:ring-[#C8F23C]/35",
    formButtonPrimary:
      "bg-[#11342B] hover:bg-[#1A4538] text-white rounded-xl normal-case text-base font-semibold py-3 min-h-[48px] shadow-none",
    footerActionLink: "text-[#11342B] font-semibold hover:text-[#1A4538]",
  },
};

export const clerkLocalization = {
  signIn: {
    start: {
      title: "Sign in",
      subtitle: "Use Google or your workshop email to continue.",
    },
  },
  signUp: {
    start: {
      title: "Create account",
      subtitle: "One free account keeps your garage safe.",
    },
  },
};
