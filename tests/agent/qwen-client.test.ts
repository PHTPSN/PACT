import { describe, expect, it, vi } from "vitest";
import { HttpKilnClient, type KilnCompletionInput, type KilnTransport } from "../../src/agent/agent/llm/kiln-client.js";
import { QwenClient } from "../../src/agent/agent/llm/qwen-client.js";

describe("Qwen/Kiln clients", () => {
  it("normalizes JSON decisions and always selects qwen3-32b", async () => {
    let request: KilnCompletionInput | undefined;
    const kiln: KilnTransport = {
      async complete(input) {
        request = input;
        return { content: '```json\n{"type":"final","message":"hello"}\n```' };
      },
    };
    const qwen = new QwenClient(kiln);
    const decision = await qwen.decide({
      systemPrompt: "system",
      userMessage: "hello",
      toolResults: [],
    });
    expect(decision).toEqual({ type: "final", message: "hello" });
    expect(request?.model).toBe("qwen3-32b");
  });

  it("rejects malformed Qwen JSON", async () => {
    const qwen = new QwenClient({
      async complete() {
        return { content: "not json" };
      },
    });
    await expect(
      qwen.decide({ systemPrompt: "system", userMessage: "hello", toolResults: [] }),
    ).rejects.toThrow("malformed JSON");
  });

  it("keeps the API key inside the HTTP transport and returns only normalized content", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer kiln-secret" });
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: "qwen3-32b" });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"type":"final","message":"ok"}' } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const client = new HttpKilnClient({ apiKey: "kiln-secret", fetch: fetchMock as typeof fetch });
    const result = await client.complete({
      model: "qwen3-32b",
      messages: [{ role: "user", content: "test" }],
    });
    expect(result).toEqual({ content: '{"type":"final","message":"ok"}' });
    expect(JSON.stringify(result)).not.toContain("kiln-secret");
  });
});
