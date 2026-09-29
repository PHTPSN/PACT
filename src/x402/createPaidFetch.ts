import { x402Erc7710Client } from '@metamask/x402'
import {
  METAMASK_FACILITATOR_ADDRESSES_DEV,
  createx402DelegationProvider,
} from '@metamask/smart-accounts-kit/experimental'
import { decodeDelegations } from '@metamask/smart-accounts-kit/utils'
import { x402Client, x402HTTPClient } from '@x402/core/client'
import { wrapFetchWithPayment } from '@x402/fetch'
import { getAddress } from 'viem'

import {
  BASE_SEPOLIA_NETWORK,
  BASE_SEPOLIA_USDC,
  ONE_USDC,
} from './constants.js'
import type {
  PaidFetchAuditEvent,
  PaidFetchConfig,
  PaidFetchResult,
} from './types.js'

function now(): string {
  return new Date().toISOString()
}

export function createPaidFetch({
  agentAccount,
  rootPermissionContext,
  environment,
  maximumPaymentAmount = ONE_USDC,
  childExpirySeconds = 300,
  facilitatorAddresses = METAMASK_FACILITATOR_ADDRESSES_DEV,
  fetch: baseFetch = globalThis.fetch,
}: PaidFetchConfig) {
  if (maximumPaymentAmount <= 0n) {
    throw new Error('maximumPaymentAmount must be greater than zero.')
  }
  if (!Number.isSafeInteger(childExpirySeconds) || childExpirySeconds <= 0) {
    throw new Error('childExpirySeconds must be a positive integer.')
  }
  const delegationChain = decodeDelegations(rootPermissionContext)
  const parentDelegation = delegationChain[0]
  const rootDelegation = delegationChain.at(-1)
  if (!parentDelegation || !rootDelegation) {
    throw new Error('rootPermissionContext must contain a delegation chain.')
  }
  if (parentDelegation.delegate.toLowerCase() !== agentAccount.address.toLowerCase()) {
    throw new Error('The root delegation is not delegated to this AgentSession.')
  }
  const rootDelegator = getAddress(rootDelegation.delegator)

  return async function paidFetch<T = unknown>(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<PaidFetchResult<T>> {
    const audit: PaidFetchAuditEvent[] = []
    let attempt = 0

    const delegationProvider = createx402DelegationProvider({
      account: agentAccount,
      from: agentAccount.address,
      environment,
      parentPermissionContext: rootPermissionContext,
      expirySeconds: childExpirySeconds,
      redeemers: {
        requireRedeemers: true,
        addresses: [...facilitatorAddresses],
      },
    })
    const delegatedScheme = new x402Erc7710Client({ delegationProvider })
    const coreClient = new x402Client()
      .setSpendControls({
        maxAmountPerPayment: false,
        allowedAssets: [
          {
            network: BASE_SEPOLIA_NETWORK,
            asset: BASE_SEPOLIA_USDC,
            maxAmountPerPayment: maximumPaymentAmount.toString(),
          },
        ],
      })
      .register(BASE_SEPOLIA_NETWORK, delegatedScheme)

    coreClient.onBeforePaymentCreation(async ({ selectedRequirements }) => {
      if (selectedRequirements.network !== BASE_SEPOLIA_NETWORK) {
        return { abort: true, reason: 'Only Base Sepolia payments are allowed.' }
      }
      if (selectedRequirements.asset.toLowerCase() !== BASE_SEPOLIA_USDC.toLowerCase()) {
        return { abort: true, reason: 'Only Base Sepolia USDC payments are allowed.' }
      }
      if (BigInt(selectedRequirements.amount) > maximumPaymentAmount) {
        return {
          abort: true,
          reason: `Payment amount ${selectedRequirements.amount} exceeds the local per-payment ceiling ${maximumPaymentAmount}.`,
        }
      }
    })
    coreClient.onAfterPaymentCreation(async () => {
      audit.push({
        phase: 'delegated-payment-created',
        agentSession: agentAccount.address,
        rootDelegator,
        at: now(),
      })
    })
    coreClient.onPaymentResponse(async ({ settleResponse }) => {
      if (settleResponse) {
        audit.push({
          phase: 'settlement-response',
          success: settleResponse.success,
          transaction: settleResponse.transaction,
          network: settleResponse.network,
          at: now(),
        })
      }
    })

    const httpClient = new x402HTTPClient(coreClient).onPaymentRequired(
      async ({ paymentRequired }) => {
        const accepted = paymentRequired.accepts[0]
        if (accepted) {
          audit.push({
            phase: 'payment-required',
            network: accepted.network,
            asset: accepted.asset,
            amount: accepted.amount,
            payTo: accepted.payTo,
            at: now(),
          })
        }
      },
    )
    const auditedFetch: typeof globalThis.fetch = async (request, requestInit) => {
      const response = await baseFetch(request, requestInit)
      attempt += 1
      audit.push({
        phase: 'http-response',
        attempt,
        status: response.status,
        at: now(),
      })
      return response
    }
    const fetchWithPayment = wrapFetchWithPayment(auditedFetch, httpClient)
    const response = await fetchWithPayment(input, init)

    const firstResponse = audit.find(
      (event): event is Extract<PaidFetchAuditEvent, { phase: 'http-response' }> =>
        event.phase === 'http-response' && event.attempt === 1,
    )
    if (firstResponse?.status !== 402) {
      throw new Error(
        `The protected x402 resource did not begin with HTTP 402 (received ${firstResponse?.status ?? 'no response'}).`,
      )
    }

    const parsed = await httpClient.processResponse(response.clone())
    if (parsed.paymentStatus !== 'settled' || !parsed.header || !('success' in parsed.header)) {
      const rejection =
        parsed.header && 'error' in parsed.header
          ? ` Facilitator/server reason: ${parsed.header.error ?? 'unspecified'}.`
          : ''
      throw new Error(
        `x402 payment was not settled; final HTTP status ${response.status}, payment status ${parsed.paymentStatus}.${rejection}`,
      )
    }
    if (!parsed.header.success || !response.ok) {
      throw new Error(
        `x402 settlement failed: ${parsed.header.errorReason ?? parsed.header.errorMessage ?? response.statusText}.`,
      )
    }

    return {
      resource: parsed.body as T,
      response,
      settlement: parsed.header,
      audit: Object.freeze([...audit]),
    }
  }
}
