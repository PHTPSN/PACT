import { x402Client, x402HTTPClient } from '@x402/core/client'
import { getAddress } from 'viem'

import { BASE_SEPOLIA_NETWORK, BASE_SEPOLIA_USDC } from './constants.js'
import type {
  InspectPaidResourceConfig,
  PaidResourceInspection,
} from './types.js'

function readString(
  extra: Readonly<Record<string, unknown>> | null | undefined,
  key: string,
): string {
  const value = extra?.[key]
  return typeof value === 'string' ? value : ''
}

async function optionalJson(response: Response): Promise<unknown> {
  try {
    return await response.clone().json()
  } catch {
    return undefined
  }
}

/**
 * Performs an unsigned request and normalizes the server's authoritative x402
 * requirement. It never creates a payment payload or invokes a signer.
 */
export function createPaidResourceInspector({
  expectedNetwork = BASE_SEPOLIA_NETWORK,
  expectedAsset = BASE_SEPOLIA_USDC,
  expectedPayTo,
  fetch: baseFetch = globalThis.fetch,
}: InspectPaidResourceConfig = {}) {
  const httpClient = new x402HTTPClient(new x402Client())

  return async function inspectPaidResource(
    url: string,
  ): Promise<PaidResourceInspection> {
    const response = await baseFetch(url, {
      headers: { accept: 'application/json' },
    })
    if (response.ok) {
      return { url, status: response.status, requiresPayment: false }
    }
    if (response.status !== 402) {
      throw new Error(`Resource inspection failed with HTTP ${response.status}.`)
    }

    const paymentRequired = httpClient.getPaymentRequiredResponse(
      name => response.headers.get(name),
      await optionalJson(response),
    )
    if (paymentRequired.x402Version !== 2) {
      throw new Error('Only x402 v2 payment requirements are supported.')
    }
    const accepted = paymentRequired.accepts.find(
      candidate =>
        candidate.scheme === 'exact' &&
        candidate.network === expectedNetwork &&
        candidate.asset.toLowerCase() === expectedAsset.toLowerCase() &&
        readString(candidate.extra, 'assetTransferMethod') === 'eip3009' &&
        readString(candidate.extra, 'paymentFlow') === 'authorization' &&
        (!expectedPayTo ||
          candidate.payTo.toLowerCase() === expectedPayTo.toLowerCase()),
    )
    if (!accepted) {
      throw new Error(
        'The resource did not offer the configured exact-EVM payment profile.',
      )
    }

    return {
      url,
      status: 402,
      requiresPayment: true,
      x402Version: 2,
      scheme: accepted.scheme,
      network: accepted.network,
      asset: accepted.asset,
      amount: BigInt(accepted.amount),
      payTo: getAddress(accepted.payTo),
      assetTransferMethod: readString(accepted.extra, 'assetTransferMethod'),
      paymentFlow: readString(accepted.extra, 'paymentFlow'),
    }
  }
}
