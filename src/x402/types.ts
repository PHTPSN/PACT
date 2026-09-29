import type {
  PermissionContext,
  SmartAccountsEnvironment,
} from '@metamask/smart-accounts-kit'
import type { SettleResponse } from '@x402/core/types'
import type { Account, Address } from 'viem'

export type PaidFetchAuditEvent =
  | {
      phase: 'http-response'
      attempt: number
      status: number
      at: string
    }
  | {
      phase: 'payment-required'
      network: string
      asset: string
      amount: string
      payTo: string
      at: string
    }
  | {
      phase: 'delegated-payment-created'
      agentSession: Address
      rootDelegator: Address
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
  agentAccount: Account
  rootPermissionContext: PermissionContext
  environment: SmartAccountsEnvironment
  maximumPaymentAmount?: bigint
  childExpirySeconds?: number
  facilitatorAddresses?: readonly Address[]
  fetch?: typeof globalThis.fetch
}
