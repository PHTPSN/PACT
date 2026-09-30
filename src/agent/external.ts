import type { AuditEvent } from "./audit/types.js";

export type Address = `0x${string}`;

export interface TreasuryState {
  address: Address;
  balance: string;
  members: Address[];
  threshold: number;
}

export interface OperatingBudget {
  walletAddress: Address;
  balance: string;
  currency: string;
  maxPerCall?: string;
  maxPerSession?: string;
}

export interface PaidResourceQuote {
  url: string;
  requiresPayment: boolean;
  amount?: string;
  currency?: string;
  network?: string;
  payTo?: Address;
}

export interface PaidFetchResult {
  url: string;
  status: number;
  paid: boolean;
  amountPaid?: string;
  currency?: string;
  network?: string;
  txHash?: string;
  body: unknown;
}

export interface TreasuryReader {
  getTreasuryState(): Promise<TreasuryState>;
}

export interface BudgetReader {
  getOperatingBudget(): Promise<OperatingBudget>;
}

export interface PaymentGateway {
  inspectPaidResource(url: string): Promise<PaidResourceQuote>;
  paidFetch(input: { url: string; maxAmount?: string }): Promise<PaidFetchResult>;
}

export interface AuditReader {
  getAuditHistory(input?: { limit?: number }): Promise<AuditEvent[]>;
}

export interface ExternalAdapters {
  treasuryReader: TreasuryReader;
  budgetReader: BudgetReader;
  paymentGateway: PaymentGateway;
  auditReader: AuditReader;
}
