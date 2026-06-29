import { NextRequest, NextResponse } from "next/server";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const AZURE_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const AZURE_KEY = process.env.AZURE_OPENAI_API_KEY;
const AZURE_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT;

const DEMO_REPLIES = [
  "Of course! What's your vehicle registration, and which day suits you best?",
  "We've got slots Tuesday morning and Thursday afternoon next week. Shall I pencil you in?",
  "Lovely, that's logged. The team will confirm your slot shortly. Anything else I can help with?",
  "An MOT with us takes about 45 minutes, and the retest is free within 10 working days.",
];

async function callOpenAI(messages: ChatMessage[]): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages,
      max_tokens: 300,
      temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function callAzure(messages: ChatMessage[]): Promise<string> {
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2025-01-01-preview";
  const url = `${AZURE_ENDPOINT}/openai/deployments/${AZURE_DEPLOYMENT}/chat/completions?api-version=${apiVersion}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": AZURE_KEY!,
    },
    // GPT-5-family deployments reject max_tokens/temperature; use the new param only.
    body: JSON.stringify({ messages, max_completion_tokens: 1000 }),
  });
  if (!res.ok) throw new Error(`azure ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

export async function POST(req: NextRequest) {
  const { systemPrompt, messages } = (await req.json()) as {
    systemPrompt: string;
    messages: { role: "user" | "assistant"; content: string }[];
  };

  if (!systemPrompt || !Array.isArray(messages)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const chat: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages.slice(-20),
  ];

  try {
    if (OPENAI_KEY) {
      return NextResponse.json({ reply: await callOpenAI(chat), mode: "openai" });
    }
    if (AZURE_ENDPOINT && AZURE_KEY && AZURE_DEPLOYMENT) {
      return NextResponse.json({ reply: await callAzure(chat), mode: "azure" });
    }
  } catch (err) {
    console.error("agent chat LLM call failed:", err);
    return NextResponse.json({ error: "llm_failed" }, { status: 502 });
  }

  // Demo mode: deterministic canned replies until an LLM key is configured.
  const userTurns = messages.filter((m) => m.role === "user").length;
  const reply = DEMO_REPLIES[(userTurns - 1 + DEMO_REPLIES.length) % DEMO_REPLIES.length];
  return NextResponse.json({ reply, mode: "demo" });
}
