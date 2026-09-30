import { encodePaymentRequiredHeader } from '@x402/core/http'
import { describe, expect, it, vi } from 'vitest'

import {
  BASE_SEPOLIA_NETWORK,
  BASE_SEPOLIA_USDC,
} from '../../src/x402/constants.js'
import { createPaidResourceInspector } from '../../src/x402/inspectPaidResource.js'

const merchant = '0x4000000000000000000000000000000000000000'

describe('x402 paid-resource inspection', () => {
  it('decodes the real HTTP 402 requirement without creating a payment', async () => {
    const paymentRequired = encodePaymentRequiredHeader({
      x402Version: 2,
      resource: { url: 'https://resource.example/premium' },
      accepts: [
        {
          scheme: 'exact',
          network: BASE_SEPOLIA_NETWORK,
          amount: '100000',
          asset: BASE_SEPOLIA_USDC,
          payTo: merchant,
          maxTimeoutSeconds: 300,
          extra: {
            assetTransferMethod: 'eip3009',
            paymentFlow: 'authorization',
          },
        },
      ],
    })
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'payment_required' }), {
        status: 402,
        headers: {
          'content-type': 'application/json',
          'payment-required': paymentRequired,
        },
      }),
    )
    const inspect = createPaidResourceInspector({
      fetch: fetchMock as typeof fetch,
    })

    await expect(
      inspect('https://resource.example/premium'),
    ).resolves.toMatchObject({
      requiresPayment: true,
      status: 402,
      amount: 100_000n,
      network: BASE_SEPOLIA_NETWORK,
      asset: BASE_SEPOLIA_USDC,
      payTo: merchant,
      assetTransferMethod: 'eip3009',
      paymentFlow: 'authorization',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('reports an ordinary successful resource as free', async () => {
    const inspect = createPaidResourceInspector({
      fetch: (async () =>
        new Response(JSON.stringify({ public: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as typeof fetch,
    })

    await expect(inspect('https://resource.example/free')).resolves.toEqual({
      url: 'https://resource.example/free',
      status: 200,
      requiresPayment: false,
    })
  })
})
