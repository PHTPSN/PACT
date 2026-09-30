import { ExternalAdapterError } from "../errors.js";
import type {
  BudgetReader,
  OperatingBudget,
  PaidFetchResult,
  PaidResourceQuote,
  PaymentGateway,
  TreasuryReader,
  TreasuryState,
} from "../external.js";

export const MOCK_TREASURY: TreasuryState = {
  address: "0x1000000000000000000000000000000000000000",
  balance: "250.00",
  members: [
    "0x2000000000000000000000000000000000000000",
    "0x3000000000000000000000000000000000000000",
  ],
  threshold: 2,
};

export const MOCK_BUDGET: OperatingBudget = {
  walletAddress: "0x4000000000000000000000000000000000000000",
  balance: "10.00",
  currency: "USDC",
  maxPerCall: "1.00",
  maxPerSession: "5.00",
};

export class MockTreasuryReader implements TreasuryReader {
  calls = 0;
  constructor(private readonly state: TreasuryState = MOCK_TREASURY) {}

  async getTreasuryState(): Promise<TreasuryState> {
    this.calls += 1;
    return structuredClone(this.state);
  }
}

export class MockBudgetReader implements BudgetReader {
  calls = 0;
  constructor(private readonly budget: OperatingBudget = MOCK_BUDGET) {}

  async getOperatingBudget(): Promise<OperatingBudget> {
    this.calls += 1;
    return structuredClone(this.budget);
  }
}

export interface MockResource {
  quote: PaidResourceQuote;
  result?: PaidFetchResult;
  rejection?: {
    code: string;
    message: string;
  };
}

export class MockPaymentGateway implements PaymentGateway {
  readonly inspectCalls: string[] = [];
  readonly fetchCalls: Array<{ url: string; maxAmount?: string }> = [];
  readonly paymentAttempts: string[] = [];

  constructor(private readonly resources: Readonly<Record<string, MockResource>>) {}

  async inspectPaidResource(url: string): Promise<PaidResourceQuote> {
    this.inspectCalls.push(url);
    const resource = this.resources[url];
    if (!resource) throw new ExternalAdapterError("RESOURCE_NOT_FOUND", "Resource is not configured.");
    return structuredClone(resource.quote);
  }

  async paidFetch(input: { url: string; maxAmount?: string }): Promise<PaidFetchResult> {
    this.fetchCalls.push(structuredClone(input));
    const resource = this.resources[input.url];
    if (!resource) throw new ExternalAdapterError("RESOURCE_NOT_FOUND", "Resource is not configured.");
    if (resource.quote.requiresPayment) this.paymentAttempts.push(input.url);
    if (resource.rejection) {
      throw new ExternalAdapterError(
        resource.rejection.code,
        resource.rejection.message,
        false,
        { reason: resource.rejection.code },
      );
    }
    if (!resource.result) {
      throw new ExternalAdapterError("NO_MOCK_RESULT", "No resource result is configured.");
    }
    return structuredClone(resource.result);
  }
}

export const FREE_RESOURCE_URL = "https://resources.example/free";
export const PAID_RESOURCE_URL = "https://resources.example/premium";
export const REJECTED_RESOURCE_URL = "https://resources.example/too-expensive";

export function createMockResources(): Record<string, MockResource> {
  return {
    [FREE_RESOURCE_URL]: {
      quote: { url: FREE_RESOURCE_URL, requiresPayment: false },
      result: {
        url: FREE_RESOURCE_URL,
        status: 200,
        paid: false,
        body: { summary: "Public resource contents" },
      },
    },
    [PAID_RESOURCE_URL]: {
      quote: {
        url: PAID_RESOURCE_URL,
        requiresPayment: true,
        amount: "0.10",
        currency: "USDC",
        network: "mock-network",
        payTo: "0x5000000000000000000000000000000000000000",
      },
      result: {
        url: PAID_RESOURCE_URL,
        status: 200,
        paid: true,
        amountPaid: "0.10",
        currency: "USDC",
        txHash: "0xmock-transaction-hash",
        body: { summary: "Premium dataset contents" },
      },
    },
    [REJECTED_RESOURCE_URL]: {
      quote: {
        url: REJECTED_RESOURCE_URL,
        requiresPayment: true,
        amount: "25.00",
        currency: "USDC",
      },
      rejection: {
        code: "PAYMENT_POLICY_REJECTED",
        message: "External payment policy rejected the requested payment.",
      },
    },
  };
}
