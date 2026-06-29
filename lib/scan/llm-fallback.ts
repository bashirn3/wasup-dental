export interface LlmRow {
  name: string;
  plate: string;
  phone: string;
}

/**
 * Semantic classification fallback for rows that rules can't resolve.
 * Sends the row's tokens and demands strict JSON. Returns null if the LLM
 * isn't configured or the response isn't valid JSON.
 */
export async function classifyRowWithLlm(tokens: string[]): Promise<LlmRow | null> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const key = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  if (!endpoint || !key || !deployment) return null;

  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2025-01-01-preview";
  const url = `${endpoint.replace(/\/+$/, "")}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

  const system =
    "You normalise OCR tokens from a single row of a UK garage customer register. " +
    'Return ONLY JSON: {"name":"","plate":"","phone":""}. No prose, no markdown. ' +
    "plate is a UK registration; phone is a UK number; name is a person's name. " +
    "Leave a field as an empty string if absent.";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Tokens: ${JSON.stringify(tokens)}` },
        ],
        max_completion_tokens: 400,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return null;
    return {
      name: String(parsed.name ?? ""),
      plate: String(parsed.plate ?? ""),
      phone: String(parsed.phone ?? ""),
    };
  } catch {
    return null;
  }
}
