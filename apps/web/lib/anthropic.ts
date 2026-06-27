import Anthropic from "@anthropic-ai/sdk";

/**
 * Server-only Anthropic client. Never import this from a client component —
 * it reads ANTHROPIC_API_KEY, which must stay server-side.
 *
 * The handoff pins classification/extraction to claude-sonnet-4-6.
 */
export const MODEL = "claude-sonnet-4-6";

let client: Anthropic | null = null;

/** Whether a key is configured. Routes use this to fail clearly instead of calling Claude blind. */
export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function getAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  if (!client) {
    client = new Anthropic({ apiKey });
  }
  return client;
}

/** Concatenate the text content blocks of a message. */
export function messageText(res: Anthropic.Message): string {
  return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

/** Parse JSON, tolerating stray markdown fences (belt-and-suspenders for structured output). */
export function parseJsonLoose(text: string): unknown {
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}
