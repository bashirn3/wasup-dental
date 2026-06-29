import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { resolvePracticeMembership } from "@/lib/dental-auth";
import { treatmentLabels } from "@/lib/dental-demo-data";
import type { TreatmentKey } from "@/lib/dental-types";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function normalizeUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const clean = value.trim().startsWith("http") ? value.trim() : `https://${value.trim()}`;
    const url = new URL(clean);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function summarize(html: string, url: string, treatment: TreatmentKey) {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe, nav, footer").remove();
  const title = compactText($("title").first().text());
  const description = compactText(
    $("meta[name='description']").attr("content") ??
      $("meta[property='og:description']").attr("content") ??
      "",
  );
  const headings = $("h1, h2, h3")
    .map((_, element) => compactText($(element).text()))
    .get()
    .filter((item, index, arr) => item.length > 6 && arr.indexOf(item) === index)
    .slice(0, 10);
  const bodyText = compactText($("body").text()).slice(0, 12000);
  const treatmentLabel = treatmentLabels[treatment].toLowerCase();
  const relevant = bodyText
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => {
      const lower = sentence.toLowerCase();
      return [
        treatmentLabel,
        "consultation",
        "appointment",
        "finance",
        "price",
        "fee",
        "smile",
        "patient",
      ].some((keyword) => lower.includes(keyword));
    })
    .slice(0, 12);

  const summary =
    description || relevant[0] || headings[0] || `${title || "Website"} scanned for clinic knowledge.`;

  return {
    treatment,
    sourceUrls: [url],
    summary: summary.slice(0, 420),
    benefits: (headings.length ? headings : relevant).slice(0, 4),
    pricing:
      relevant.find((sentence) => /price|fee|cost|from|£|€|\$/.test(sentence.toLowerCase())) ??
      "Pricing was not clearly found on the scanned page.",
    finance:
      relevant.find((sentence) => /finance|monthly|payment plan|installment|instalment/.test(sentence.toLowerCase())) ??
      "Finance details were not clearly found on the scanned page.",
    consultationCta: "Ask one clear next question, then offer a consultation request.",
    confidence: Math.min(0.92, Math.max(0.55, headings.length * 0.04 + relevant.length * 0.06)),
    raw: { title, description, headings, relevantSentenceCount: relevant.length },
  };
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    practiceId?: string | null;
    websiteUrl?: string;
    treatment?: TreatmentKey;
  };
  const websiteUrl = normalizeUrl(body.websiteUrl);
  const treatment = body.treatment ?? "invisalign";
  if (!websiteUrl) return NextResponse.json({ error: "invalid_website_url" }, { status: 400 });

  const membership = await resolvePracticeMembership(body.practiceId ?? null);

  let html = "";
  try {
    const res = await fetch(websiteUrl, {
      headers: {
        "user-agent": "WasupDentalBot/1.0 (+https://wasup.co)",
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return NextResponse.json({ error: "website_fetch_failed", status: res.status }, { status: 502 });
    html = await res.text();
  } catch (error) {
    return NextResponse.json(
      { error: "website_fetch_failed", detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }

  const knowledge = summarize(html, websiteUrl, treatment);
  const supabase = supabaseAdmin();
  if (!supabase || !membership?.practiceId) {
    return NextResponse.json({ ok: true, persisted: false, knowledge });
  }

  const { error } = await supabase.from("knowledge_packets").insert({
    practice_id: membership.practiceId,
    treatment,
    source_urls: knowledge.sourceUrls,
    summary: knowledge.summary,
    payload: knowledge,
    confidence: knowledge.confidence,
  });

  if (error) return NextResponse.json({ error: "knowledge_save_failed" }, { status: 500 });
  return NextResponse.json({ ok: true, persisted: true, knowledge });
}
