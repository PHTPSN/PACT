import { erc20Abi, formatUnits, isHex, parseUnits, type Address } from 'viem'

import { inspectTreasury, type Treasury } from '../../treasury/index.js'
import {
  BASE_SEPOLIA_NETWORK,
  BASE_SEPOLIA_USDC,
  BASE_SEPOLIA_USDC_DECIMALS,
  createPaidFetch,
  createPaidResourceInspector,
  type InspectPaidResourceConfig,
  type PaidFetchConfig,
  type PaidFetchResult as PactPaidFetchResult,
  type PaidResourceInspection,
} from '../../x402/index.js'
import { ExternalAdapterError } from '../errors.js'
import type {
  BudgetReader,
  OperatingBudget,
  PaidFetchResult,
  PaidResourceQuote,
  PaymentGateway,
  TreasuryReader,
  TreasuryState,
} from '../external.js'

export interface TokenBalanceClient {
  readContract(parameters: {
    address: Address
    abi: typeof erc20Abi
    functionName: 'balanceOf'
    args: readonly [Address]
  }): Promise<bigint>
}

export interface AgentTokenConfig {
  address: Address
  symbol: string
  decimals: number
}

export interface PactTreasuryReaderOptions {
  treasury: Treasury
  publicClient: TokenBalanceClient
  token: AgentTokenConfig
  inspect?: typeof inspectTreasury
}

export class PactTreasuryReader implements TreasuryReader {
  readonly #options: PactTreasuryReaderOptions

  constructor(options: PactTreasuryReaderOptions) {
    this.#options = options
  }

  async getTreasuryState(): Promise<TreasuryState> {
    const inspect = this.#options.inspect ?? inspectTreasury
    const inspection = await inspect(this.#options.treasury)
    const balance = await this.#options.publicClient.readContract({
      address: this.#options.token.address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [inspection.address],
    })
    return {
      address: inspection.address,
      balance: formatUnits(balance, this.#options.token.decimals),
      members: [...inspection.owners],
      threshold: inspection.threshold,
    }
  }
}

export interface PactBudgetReaderOptions {
  walletAddress: Address
  publicClient: TokenBalanceClient
  token: AgentTokenConfig
  maxPerCall?: bigint
  maxPerSession?: bigint
}

export class PactBudgetReader implements BudgetReader {
  readonly #options: PactBudgetReaderOptions

  constructor(options: PactBudgetReaderOptions) {
    this.#options = options
  }

  async getOperatingBudget(): Promise<OperatingBudget> {
    const balance = await this.#options.publicClient.readContract({
      address: this.#options.token.address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [this.#options.walletAddress],
    })
    return {
      walletAddress: this.#options.walletAddress,
      balance: formatUnits(balance, this.#options.token.decimals),
      currency: this.#options.token.symbol,
      ...(this.#options.maxPerCall === undefined
        ? {}
        : {
            maxPerCall: formatUnits(
              this.#options.maxPerCall,
              this.#options.token.decimals,
            ),
          }),
      ...(this.#options.maxPerSession === undefined
        ? {}
        : {
            maxPerSession: formatUnits(
              this.#options.maxPerSession,
              this.#options.token.decimals,
            ),
          }),
    }
  }
}

export type InspectPaymentRequirement = (
  url: string,
) => Promise<PaidResourceInspection>

export type ExecutePactPaidFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<PactPaidFetchResult<unknown>>

export interface PactPaymentGatewayOptions {
  inspect: InspectPaymentRequirement
  executePaidFetch: ExecutePactPaidFetch
  token: AgentTokenConfig
  maximumPaymentAmount: bigint
  fetch?: typeof globalThis.fetch
}

async function responseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  return contentType.includes('application/json')
    ? response.json()
    : response.text()
}

function authoritativeTransaction(transaction: string): string {
  if (!isHex(transaction) || transaction.length !== 66) {
    throw new ExternalAdapterError(
      'INVALID_SETTLEMENT_EVIDENCE',
      'The payment provider did not return a valid transaction hash.',
    )
  }
  return transaction
}

export class PactPaymentGateway implements PaymentGateway {
  readonly #options: PactPaymentGatewayOptions

  constructor(options: PactPaymentGatewayOptions) {
    if (options.maximumPaymentAmount <= 0n) {
      throw new Error('maximumPaymentAmount must be greater than zero.')
    }
    this.#options = options
  }

  async inspectPaidResource(url: string): Promise<PaidResourceQuote> {
    try {
      return this.normalizeQuote(await this.#options.inspect(url))
    } catch (error) {
      if (error instanceof ExternalAdapterError) throw error
      throw new ExternalAdapterError(
        'RESOURCE_INSPECTION_FAILED',
        'The x402 payment requirement could not be inspected.',
        false,
        { reason: error instanceof Error ? error.message : 'Unknown inspection failure.' },
      )
    }
  }

  async paidFetch(input: {
    url: string
    maxAmount?: string
  }): Promise<PaidFetchResult> {
    const inspection = await this.inspectRequirement(input.url)
    if (!inspection.requiresPayment) {
      const response = await (this.#options.fetch ?? globalThis.fetch)(input.url, {
        headers: { accept: 'application/json' },
      })
      if (!response.ok) {
        throw new ExternalAdapterError(
          'RESOURCE_FETCH_FAILED',
          `The resource returned HTTP ${response.status}.`,
          false,
          { status: response.status },
        )
      }
      return {
        url: input.url,
        status: response.status,
        paid: false,
        body: await responseBody(response),
      }
    }

    this.enforceAmountLimits(inspection.amount, input.maxAmount)
    try {
      const result = await this.#options.executePaidFetch(input.url, {
        headers: { accept: 'application/json' },
      })
      if (!result.settlement.success) {
        throw new ExternalAdapterError(
          'PAYMENT_REJECTED',
          'The hosted facilitator did not report a successful settlement.',
          false,
          { status: result.response.status },
        )
      }
      return {
        url: input.url,
        status: result.response.status,
        paid: true,
        amountPaid: formatUnits(
          inspection.amount,
          this.#options.token.decimals,
        ),
        currency: this.#options.token.symbol,
        network: inspection.network,
        txHash: authoritativeTransaction(result.settlement.transaction),
        body: result.resource,
      }
    } catch (error) {
      if (error instanceof ExternalAdapterError) throw error
      const message = error instanceof Error ? error.message : ''
      const insufficient = /insufficient|exceeds.*balance/i.test(message)
      throw new ExternalAdapterError(
        insufficient ? 'INSUFFICIENT_BALANCE' : 'PAYMENT_FAILED',
        insufficient
          ? 'The Agent Wallet has insufficient balance for this payment.'
          : 'The hosted x402 payment failed or was rejected.',
        false,
        {
          status: 402,
          reason: insufficient ? 'INSUFFICIENT_BALANCE' : 'PAYMENT_FAILED',
        },
      )
    }
  }

  private async inspectRequirement(url: string): Promise<PaidResourceInspection> {
    try {
      return await this.#options.inspect(url)
    } catch (error) {
      if (error instanceof ExternalAdapterError) throw error
      throw new ExternalAdapterError(
        'RESOURCE_INSPECTION_FAILED',
        'The x402 payment requirement could not be inspected.',
      )
    }
  }

  private normalizeQuote(inspection: PaidResourceInspection): PaidResourceQuote {
    if (!inspection.requiresPayment) {
      return { url: inspection.url, requiresPayment: false }
    }
    return {
      url: inspection.url,
      requiresPayment: true,
      amount: formatUnits(inspection.amount, this.#options.token.decimals),
      currency: this.#options.token.symbol,
      network: inspection.network,
      payTo: inspection.payTo,
    }
  }

  private enforceAmountLimits(amount: bigint, requestedMaximum?: string): void {
    if (amount > this.#options.maximumPaymentAmount) {
      throw new ExternalAdapterError(
        'PAYMENT_POLICY_REJECTED',
        'The quoted amount exceeds the configured per-payment limit.',
        false,
        {
          amount: amount.toString(),
          maximumPaymentAmount: this.#options.maximumPaymentAmount.toString(),
        },
      )
    }
    if (requestedMaximum === undefined) return

    let requestedMaximumAtomic: bigint
    try {
      requestedMaximumAtomic = parseUnits(
        requestedMaximum,
        this.#options.token.decimals,
      )
    } catch {
      throw new ExternalAdapterError(
        'INVALID_MAX_AMOUNT',
        'The requested maximum amount cannot be represented by the configured token.',
      )
    }
    if (amount > requestedMaximumAtomic) {
      throw new ExternalAdapterError(
        'PAYMENT_POLICY_REJECTED',
        'The quoted amount exceeds the maximum accepted by the agent request.',
        false,
        {
          amount: amount.toString(),
          requestedMaximum: requestedMaximumAtomic.toString(),
        },
      )
    }
  }
}

export interface CreatePactPaymentGatewayOptions
  extends Omit<PaidFetchConfig, 'fetch'>,
    Omit<InspectPaidResourceConfig, 'fetch'> {
  token: AgentTokenConfig
  fetch?: typeof globalThis.fetch
}

export function createPactPaymentGateway(
  options: CreatePactPaymentGatewayOptions,
): PactPaymentGateway {
  const maximumPaymentAmount = options.maximumPaymentAmount
  if (maximumPaymentAmount === undefined) {
    throw new Error(
      'maximumPaymentAmount is required at the agent payment boundary.',
    )
  }
  if (
    (options.expectedNetwork ?? BASE_SEPOLIA_NETWORK) !==
    BASE_SEPOLIA_NETWORK
  ) {
    throw new Error('The existing M2 client supports only Base Sepolia.')
  }
  if (
    (options.expectedAsset ?? options.token.address).toLowerCase() !==
      BASE_SEPOLIA_USDC.toLowerCase() ||
    options.token.address.toLowerCase() !== BASE_SEPOLIA_USDC.toLowerCase() ||
    options.token.decimals !== BASE_SEPOLIA_USDC_DECIMALS
  ) {
    throw new Error(
      'The existing M2 client supports only configured Base Sepolia USDC.',
    )
  }
  const sharedFetch = options.fetch ?? globalThis.fetch
  return new PactPaymentGateway({
    inspect: createPaidResourceInspector({
      ...(options.expectedNetwork === undefined
        ? {}
        : { expectedNetwork: options.expectedNetwork }),
      ...(options.expectedAsset === undefined
        ? {}
        : { expectedAsset: options.expectedAsset }),
      ...(options.expectedPayTo === undefined
        ? {}
        : { expectedPayTo: options.expectedPayTo }),
      fetch: sharedFetch,
    }),
    executePaidFetch: createPaidFetch({
      agentWalletAccount: options.agentWalletAccount,
      maximumPaymentAmount,
      ...(options.expectedPayTo === undefined
        ? {}
        : { expectedPayTo: options.expectedPayTo }),
      fetch: sharedFetch,
    }),
    token: options.token,
    maximumPaymentAmount,
    fetch: sharedFetch,
  })
}
