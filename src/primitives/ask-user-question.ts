import type { Question, Response } from "./primitive-types.js";

export type UserTransport = (serializedPrompt: string) => Promise<string>;

function serialize(q: Question): string {
  const header = `[Gate: ${q.gateName}] ${q.prompt}`;
  if (q.type === "confirmation" || q.type === "choice") {
    const options = (q.options ?? []).map((o) => `  - ${o}`).join("\n");
    return `${header}\n${options}`;
  }
  return header;
}

export async function askUserQuestion(
  question: Question,
  transport: UserTransport,
): Promise<Response> {
  const prompt = serialize(question);
  const raw = await transport(prompt);

  if (question.type === "choice" || question.type === "confirmation") {
    const allowed = question.options ?? [];
    if (!allowed.includes(raw.trim())) {
      throw new Error(
        `Response "${raw}" does not match allowed options: ${allowed.join(", ")}`,
      );
    }
  }

  return {
    questionId: question.id,
    raw,
    parsed: raw.trim(),
    timestamp: new Date().toISOString(),
  };
}
