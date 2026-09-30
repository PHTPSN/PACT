import type { AgentModel, AgentModelInput } from "../agent/types.js";

export class ScriptedModel implements AgentModel {
  readonly inputs: AgentModelInput[] = [];
  #index = 0;

  constructor(private readonly decisions: unknown[]) {}

  async decide(input: AgentModelInput): Promise<unknown> {
    this.inputs.push(structuredClone(input));
    const decision = this.decisions[this.#index];
    this.#index += 1;
    if (decision === undefined) throw new Error("ScriptedModel has no decision left.");
    if (decision instanceof Error) throw decision;
    return structuredClone(decision);
  }
}
