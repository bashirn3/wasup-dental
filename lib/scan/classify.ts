import type { Band, FieldType } from "./types";

// --- UK formats ---------------------------------------------------------------
// Current plate format (since 2001): two letters, two digits, three letters.
const PLATE_CURRENT = /^[A-Z]{2}[0-9]{2}\s?[A-Z]{3}$/;
// Older / dateless formats seen in long-lived registers (loose).
const PLATE_PREFIX = /^[A-Z][0-9]{1,3}\s?[A-Z]{3}$/; // e.g. A123 BCD
const PLATE_SUFFIX = /^[A-Z]{3}\s?[0-9]{1,3}[A-Z]$/; // e.g. ABC 123D
const MOBILE = /^07\d{3}\s?\d{3}\s?\d{3}$/;
const LANDLINE = /^0(1|2)\d{8,9}$/;

// Common OCR confusions, applied position-aware for plates.
const LETTER_FIX: Record<string, string> = { "0": "O", "1": "I", "5": "S", "8": "B", "2": "Z", "6": "G" };
const DIGIT_FIX: Record<string, string> = { O: "0", Q: "0", D: "0", I: "1", L: "1", Z: "2", S: "5", B: "8", G: "6", A: "4" };

export interface RuleResult {
  value: string;
  ruleConfidence: number; // 0..1
  note?: string;
  corrected: boolean;
}

function cleanupAlpha(s: string): string {
  // Strip Cyrillic / non-ASCII look-alikes that DI sometimes emits.
  return s
    .normalize("NFKD")
    .replace(/[\u0400-\u04FF]/g, (c) => CYRILLIC_MAP[c] ?? c)
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

const CYRILLIC_MAP: Record<string, string> = {
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X",
};

export function classifyPlate(raw: string): RuleResult {
  const cleaned = cleanupAlpha(raw).toUpperCase().replace(/[^A-Z0-9 ]/g, "");
  const compact = cleaned.replace(/\s+/g, "");

  if (PLATE_CURRENT.test(cleaned) || PLATE_CURRENT.test(spaced(compact, 4))) {
    return { value: spaced(compact, 4), ruleConfidence: 1, corrected: cleaned !== spaced(compact, 4) };
  }
  if (PLATE_PREFIX.test(cleaned) || PLATE_SUFFIX.test(cleaned)) {
    return { value: cleaned, ruleConfidence: 0.85, corrected: false };
  }

  // Try a confusion-aware repair for the current format.
  if (compact.length === 7) {
    const fixed = repairCurrentPlate(compact);
    if (fixed && PLATE_CURRENT.test(spaced(fixed, 4))) {
      return {
        value: spaced(fixed, 4),
        ruleConfidence: 0.72,
        corrected: true,
        note: "Auto-corrected likely OCR slip (0↔O / 1↔I)",
      };
    }
  }
  return { value: cleaned, ruleConfidence: 0.25, corrected: false, note: "Does not match a UK plate format" };
}

function repairCurrentPlate(c: string): string | null {
  const chars = c.split("");
  // positions 0,1 letters; 2,3 digits; 4,5,6 letters
  const out = chars.map((ch, i) => {
    const wantLetter = i < 2 || i >= 4;
    if (wantLetter) return /[A-Z]/.test(ch) ? ch : LETTER_FIX[ch] ?? ch;
    return /[0-9]/.test(ch) ? ch : DIGIT_FIX[ch] ?? ch;
  });
  return out.join("");
}

export function classifyPhone(raw: string): RuleResult {
  const digits = cleanupAlpha(raw)
    .replace(/^\+44/, "0")
    .replace(/[^\d]/g, "");

  if (MOBILE.test(digits)) {
    return { value: groupMobile(digits), ruleConfidence: 1, corrected: groupMobile(digits) !== raw };
  }
  if (digits.length === 11 && digits.startsWith("07")) {
    return { value: groupMobile(digits), ruleConfidence: 0.9, corrected: true };
  }
  if (LANDLINE.test(digits)) {
    return { value: digits, ruleConfidence: 0.8, corrected: false, note: "Landline (not mobile)" };
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    return { value: digits, ruleConfidence: 0.55, corrected: false, note: "11 digits but not a recognised mobile" };
  }
  if (digits.length === 10 && digits.startsWith("7")) {
    return { value: groupMobile("0" + digits), ruleConfidence: 0.6, corrected: true, note: "Added leading 0" };
  }
  return { value: digits, ruleConfidence: 0.2, corrected: false, note: "Not a valid UK number" };
}

export function classifyName(raw: string): RuleResult {
  const cleaned = cleanupAlpha(raw).replace(/\s+/g, " ").trim();
  if (!cleaned) return { value: "", ruleConfidence: 0.2, corrected: false };
  const words = cleaned.split(" ").filter(Boolean);
  const titled = words
    .map((w) => (w.length > 1 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toUpperCase()))
    .join(" ");
  const looksName = /^[A-Za-z][A-Za-z'.\- ]+$/.test(cleaned) && words.length >= 1;
  const conf = looksName ? (words.length >= 2 ? 0.9 : 0.7) : 0.4;
  return {
    value: titled,
    ruleConfidence: conf,
    corrected: titled !== raw,
    note: looksName ? undefined : "Contains unexpected characters for a name",
  };
}

/** Guess a field type for a free token (read-model fallback / no header). */
export function guessFieldType(raw: string): FieldType {
  const p = classifyPlate(raw);
  const ph = classifyPhone(raw);
  if (ph.ruleConfidence >= 0.8) return "phone";
  if (p.ruleConfidence >= 0.85) return "plate";
  // digit-heavy but not a phone -> still phone candidate; else name
  const digitRatio = (raw.replace(/\D/g, "").length || 0) / Math.max(raw.length, 1);
  if (digitRatio > 0.5) return "phone";
  if (p.ruleConfidence >= 0.7) return "plate";
  return "name";
}

export function applyRule(type: FieldType, raw: string): RuleResult {
  if (type === "plate") return classifyPlate(raw);
  if (type === "phone") return classifyPhone(raw);
  return classifyName(raw);
}

// --- banding ------------------------------------------------------------------
export function bandFor(confidence: number): Band {
  if (confidence >= 0.85) return "green";
  if (confidence >= 0.65) return "amber";
  return "red";
}

export function worstBand(bands: Band[]): Band {
  if (bands.includes("red")) return "red";
  if (bands.includes("amber")) return "amber";
  return "green";
}

// --- helpers ------------------------------------------------------------------
function spaced(compact: string, splitAt: number): string {
  if (compact.length <= splitAt) return compact;
  return `${compact.slice(0, splitAt)} ${compact.slice(splitAt)}`;
}
function groupMobile(d: string): string {
  return `${d.slice(0, 5)} ${d.slice(5, 8)} ${d.slice(8)}`.trim();
}
