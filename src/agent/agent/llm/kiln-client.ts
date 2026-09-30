import { z } from "zod";

export interface KilnMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface KilnCompletionInput {
  model: "qwen3-32b";
  messages: KilnMessage[];
}

export interface KilnCompletion {
  content: string;
}

export interface KilnTransport {
  complete(input: KilnCompletionInput): Promise<KilnCompletion>;
}

export interface HttpKilnClientOptions {
  apiKey: string;
  endpoint?: string;
  fetch?: typeof globalThis.fetch;
}

const responseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({ content: z.string() }).passthrough(),
    }).passthrough(),
  ).min(1),
}).passthrough();

/**
 * The only Kiln HTTP knowledge in the agent layer. The supplied endpoint probe
 * establishes this OpenAI-compatible chat-completions shape. Native tool calls
 * are intentionally not assumed.
 */
export class HttpKilnClient implements KilnTransport {
  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: HttpKilnClientOptions) {
    if (!options.apiKey) throw new Error("A Kiln API key is required.");
    this.#apiKey = options.apiKey;
    this.#endpoint = options.endpoint ?? "https://api.bricksum.com/v1/chat/completions";
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async complete(input: KilnCompletionInput): Promise<KilnCompletion> {
    if (input.model !== "qwen3-32b") {
      throw new Error("This client permits only qwen3-32b.");
    }
    const response = await this.#fetch(this.#endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      throw new Error(`Kiln request failed with HTTP ${response.status}.`);
    }
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error("Kiln returned an invalid chat-completions response.");
    }
    return { content: parsed.data.choices[0]!.message.content };
  }
}
