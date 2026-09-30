export type AuditEventType =
  | "AGENT_TASK_STARTED"
  | "AGENT_TASK_COMPLETED"
  | "AGENT_TASK_FAILED"
  | "TOOL_REQUESTED"
  | "TOOL_SUCCEEDED"
  | "TOOL_FAILED"
  | "PAID_RESOURCE_INSPECTED"
  | "PAYMENT_REQUESTED"
  | "PAYMENT_SUCCEEDED"
  | "PAYMENT_FAILED";

export interface AuditEvent {
  id: string;
  timestamp: string;
  type: AuditEventType;
  actor: "user" | "agent" | "system";
  toolName?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export type AuditEventInput = Omit<AuditEvent, "id" | "timestamp">;

export interface AuditEmitter {
  emit(event: AuditEventInput): AuditEvent;
}
