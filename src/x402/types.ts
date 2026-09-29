import type { SettleResponse } from '@x402/core/types'
import type { Address, LocalAccount } from 'viem'

export type PaidFetchAuditEvent =
  | {
      phase: 'http-response'
      attempt: number
      status: number
      at: string
    }
  | {
      phase: 'payment-required'
      scheme: string
      network: string
      asset: string
      amount: string
      payTo: string
      assetTransferMethod: string
      paymentFlow: string
      at: string
    }
  | {
      phase: 'payment-created'
      payer: Address
      authorizationMethod: 'eip3009'
      at: string
    }
  | {
      phase: 'settlement-response'
      success: boolean
      transaction: string
      network: string
      at: string
    }

export type PaidFetchResult<T = unknown> = {
  resource: T
  response: Response
  settlement: SettleResponse
  audit: readonly PaidFetchAuditEvent[]
}
export type PaidFetchConfig = {
  agentWalletAccount: LocalAccount
  maximumPaymentAmount?: bigint
  expectedPayTo?: Address
  fetch?: typeof globalThis.fetch
}
