import { x402Client, x402HTTPClient } from '@x402/core/client'
import { registerExactEvmScheme } from '@x402/evm/exact/client'
import { wrapFetchWithPayment } from '@x402/fetch'

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
function readString(
  extra: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string {
  const value = extra?.[key]
  return typeof value === 'string' ? value : ''
}

export function createPaidFetch({
  agentWalletAccount,
  maximumPaymentAmount = ONE_USDC,
  expectedPayTo,
  fetch: baseFetch = globalThis.fetch,
}: PaidFetchConfig) {
  if (maximumPaymentAmount <= 0n) {
    throw new Error('maximumPaymentAmount must be greater than zero.')
  }

  return async function paidFetch<T = unknown>(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<PaidFetchResult<T>> {
    const audit: PaidFetchAuditEvent[] = []
    let attempt = 0
    const coreClient = new x402Client().setSpendControls({
      maxAmountPerPayment: false,
      allowedAssets: [
        {
          network: BASE_SEPOLIA_NETWORK,
          asset: BASE_SEPOLIA_USDC,
          maxAmountPerPayment: maximumPaymentAmount.toString(),
        },
      ],
    })
    registerExactEvmScheme(coreClient, {
      signer: agentWalletAccount,
      networks: [BASE_SEPOLIA_NETWORK],
    })

    coreClient.onBeforePaymentCreation(async ({ selectedRequirements }) => {
      const transferMethod = readString(
        selectedRequirements.extra,
        'assetTransferMethod',
      )
      const paymentFlow = readString(selectedRequirements.extra, 'paymentFlow')
      if (selectedRequirements.scheme !== 'exact') {
        return { abort: true, reason: 'Only the exact x402 scheme is allowed.' }
      }
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
      if (
        expectedPayTo &&
        selectedRequirements.payTo.toLowerCase() !== expectedPayTo.toLowerCase()
      ) {
        return { abort: true, reason: 'The requested payTo address is not trusted.' }
      }
      if (transferMethod !== 'eip3009' || paymentFlow !== 'authorization') {
        return {
          abort: true,
          reason: 'Only EIP-3009 authorization payments are allowed.',
        }
      }
    })
    coreClient.onAfterPaymentCreation(async () => {
      audit.push({
        phase: 'payment-created',
        payer: agentWalletAccount.address,
        authorizationMethod: 'eip3009',
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
            scheme: accepted.scheme,
            network: accepted.network,
            asset: accepted.asset,
            amount: accepted.amount,
            payTo: accepted.payTo,
            assetTransferMethod: readString(accepted.extra, 'assetTransferMethod'),
            paymentFlow: readString(accepted.extra, 'paymentFlow'),
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
    const response = await wrapFetchWithPayment(auditedFetch, httpClient)(input, init)
    const firstResponse = audit.find(
      (event): event is Extract<PaidFetchAuditEvent, { phase: 'http-response' }> =>
        event.phase === 'http-response' && event.attempt === 1,
    )
    if (firstResponse?.status !== 402) {
      throw new Error(
        `The protected resource did not begin with HTTP 402 (received ${firstResponse?.status ?? 'no response'}).`,
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
