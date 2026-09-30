import { modelDecisionSchema, type AgentModel, type AgentModelInput, type AgentModelDecision } from "../types.js";
import type { KilnTransport } from "./kiln-client.js";

function removeCodeFence(content: string): string {
  const trimmed = content.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1] ?? trimmed;
}

/** Normalizes Qwen JSON actions so Kiln response objects never reach the agent. */
export class QwenClient implements AgentModel {
  constructor(private readonly kiln: KilnTransport) {}

  async decide(input: AgentModelInput): Promise<AgentModelDecision> {
    const completion = await this.kiln.complete({
      model: "qwen3-32b",
      messages: [
        { role: "system", content: input.systemPrompt },
        {
          role: "user",
          content: [
            "User task:",
            input.userMessage,
            "",
            "Authoritative tool results so far (JSON):",
            JSON.stringify(input.toolResults),
            "",
            "Return the next JSON action only.",
          ].join("\n"),
        },
      ],
    });

    let decoded: unknown;
    try {
      decoded = JSON.parse(removeCodeFence(completion.content));
    } catch {
      throw new Error("Qwen returned malformed JSON.");
    }
    const parsed = modelDecisionSchema.safeParse(decoded);
    if (!parsed.success) throw new Error("Qwen returned an invalid action envelope.");
    return parsed.data;
  }
}
