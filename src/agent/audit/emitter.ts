import type { AuditReader } from "../external.js";
import type { AuditEmitter, AuditEvent, AuditEventInput } from "./types.js";

const SENSITIVE_KEY = /api[-_]?key|authorization|credential|private[-_]?key|secret|token/i;

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SENSITIVE_KEY.test(key))
        .map(([key, nested]) => [key, sanitize(nested)]),
    );
  }
  return value;
}

export function sanitizeAuditInput(input: AuditEventInput): AuditEventInput {
  const metadata = input.metadata
    ? (sanitize(input.metadata) as Record<string, unknown>)
    : undefined;
  return {
    ...input,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

export class InMemoryAuditLog implements AuditEmitter, AuditReader {
  readonly #events: AuditEvent[] = [];
  readonly #now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  emit(input: AuditEventInput): AuditEvent {
    const sanitized = sanitizeAuditInput(input);
    const event: AuditEvent = {
      ...sanitized,
      id: `audit-${String(this.#events.length + 1).padStart(6, "0")}`,
      timestamp: this.#now().toISOString(),
    };
    this.#events.push(event);
    return event;
  }

  async getAuditHistory(input?: { limit?: number }): Promise<AuditEvent[]> {
    const limit = input?.limit ?? this.#events.length;
    return this.#events.slice(-limit).map((event) => structuredClone(event));
  }

  get events(): readonly AuditEvent[] {
    return this.#events;
  }
}

export class RunAuditEmitter implements AuditEmitter {
  readonly events: AuditEvent[] = [];

  constructor(private readonly delegate: AuditEmitter) {}

  emit(input: AuditEventInput): AuditEvent {
    const event = this.delegate.emit(sanitizeAuditInput(input));
    this.events.push(event);
    return event;
  }
}
