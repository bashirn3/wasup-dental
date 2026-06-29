import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Schibsted_Grotesk, Space_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import ClerkDevBypassScript from "@/components/auth/ClerkDevBypassScript";
import MotionProvider from "@/components/ui/MotionProvider";
import { clerkAppearance, clerkLocalization } from "@/lib/clerk-appearance";
import { CLERK_TASK_URLS } from "@/lib/clerk-tasks";
import {
  CLERK_SIGN_IN_URL,
  CLERK_SIGN_UP_URL,
} from "@/lib/clerk-urls";
import { POST_AUTH_REDIRECT } from "@/lib/post-auth-redirect";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const schibstedGrotesk = Schibsted_Grotesk({
  variable: "--font-schibsted",
  subsets: ["latin"],
  display: "swap",
});

const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Wasup Dental · Dental lead follow-up",
  description:
    "Manage dental leads, WhatsApp conversations, and booking follow-up from one clean workspace.",
  applicationName: "Wasup Dental",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0e3b2e",
};

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const body = (
    <html
      lang="en-GB"
      className={`${geistSans.variable} ${geistMono.variable} ${schibstedGrotesk.variable} ${spaceMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );

  // Auth is optional in local dev until Clerk keys are configured.
  return clerkEnabled ? (
    <>
      <ClerkDevBypassScript />
      <ClerkProvider
        appearance={clerkAppearance}
        localization={clerkLocalization}
        taskUrls={CLERK_TASK_URLS}
        signInUrl={CLERK_SIGN_IN_URL}
        signUpUrl={CLERK_SIGN_UP_URL}
        signInFallbackRedirectUrl={POST_AUTH_REDIRECT}
        signUpFallbackRedirectUrl={POST_AUTH_REDIRECT}
      >
        {body}
      </ClerkProvider>
    </>
  ) : (
    body
  );
}
