export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const AZURE_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const AZURE_KEY = process.env.AZURE_OPENAI_API_KEY;
const AZURE_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT;

export function llmConfigured(): boolean {
  return Boolean(OPENAI_KEY || (AZURE_ENDPOINT && AZURE_KEY && AZURE_DEPLOYMENT));
}

/** Single chat completion against Azure OpenAI (preferred) or OpenAI. */
export async function chatComplete(
  messages: ChatMessage[],
  opts: { json?: boolean } = {},
): Promise<string> {
  if (AZURE_ENDPOINT && AZURE_KEY && AZURE_DEPLOYMENT) {
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2025-01-01-preview";
    const url = `${AZURE_ENDPOINT.replace(/\/+$/, "")}/openai/deployments/${AZURE_DEPLOYMENT}/chat/completions?api-version=${apiVersion}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": AZURE_KEY },
      body: JSON.stringify({
        messages,
        max_completion_tokens: 1000,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`azure ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  }

  if (OPENAI_KEY) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        messages,
        max_tokens: 600,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  }

  throw new Error("llm_not_configured");
}
