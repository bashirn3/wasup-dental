import { Instrument_Sans, Space_Grotesk } from "next/font/google";

export const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
  display: "swap",
});

export const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

export const authFontClassNames = `${instrumentSans.variable} ${spaceGrotesk.variable}`;
