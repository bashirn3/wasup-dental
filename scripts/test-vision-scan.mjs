#!/usr/bin/env node
/**
 * Smoke-test GPT-5.5 vision register extraction.
 * Usage: node scripts/test-vision-scan.mjs [image-path]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnv() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/+$/, "");
const key = process.env.AZURE_OPENAI_API_KEY;
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2024-10-21-preview";

if (!endpoint || !key || !deployment) {
  console.error("Missing AZURE_OPENAI_* env vars");
  process.exit(1);
}

const SYSTEM = `You read UK garage MOT day-book pages photographed on a phone.
Return ONLY JSON: {"rows":[{"name":"","plate":"","phone":""}]}
- plate: UK format with space (AB12 CDE) or empty
- phone: E.164 +44 or empty
- name: person name or empty
Include partial rows. Do not invent data.`;

async function scanImage(imagePath) {
  const buf = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : "image/jpeg";
  const b64 = buf.toString("base64");

  const res = await fetch(`${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`, {
    method: "POST",
    headers: { "api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract all customer rows." },
            { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
          ],
        },
      ],
      max_completion_tokens: 2000,
      response_format: { type: "json_object" },
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const json = JSON.parse(text);
  return { model: json.model, content: json.choices?.[0]?.message?.content };
}

async function main() {
  const arg = process.argv[2];
  const imagePath = arg ? path.resolve(arg) : "/tmp/scan-test/synthetic-register.jpg";

  if (!fs.existsSync(imagePath)) {
    console.error("Image not found:", imagePath);
    console.error("Run with a JPG/PNG path, or create /tmp/scan-test/synthetic-register.jpg first.");
    process.exit(1);
  }

  console.log("Scanning:", imagePath);
  const { model, content } = await scanImage(imagePath);
  console.log("Model:", model);
  console.log("Output:\n", content);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
