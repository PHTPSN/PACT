import { createCdpFacilitatorClient } from '@coinbase/cdp-sdk/x402'
import { x402ResourceServer } from '@x402/core/server'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import { paymentMiddleware } from '@x402/express'
import express, { type Express } from 'express'
import { getAddress, type Address } from 'viem'

import {
  BASE_SEPOLIA_NETWORK,
  BASE_SEPOLIA_USDC,
  BASE_SEPOLIA_USDC_EIP712_NAME,
  BASE_SEPOLIA_USDC_EIP712_VERSION,
  TEN_CENTS_USDC,
} from './constants.js'

export type PremiumServerConfig = {
  payTo: Address
  amount?: bigint
}
export function createPremiumServer({
  payTo,
  amount = TEN_CENTS_USDC,
}: PremiumServerConfig): Express {
  if (amount <= 0n) throw new Error('Premium endpoint price must be positive.')

  const facilitator = createCdpFacilitatorClient()
  const resourceServer = new x402ResourceServer(facilitator).register(
    BASE_SEPOLIA_NETWORK,
    new ExactEvmScheme(),
  )
  const app = express()

  app.use(express.json())
  app.use(
    paymentMiddleware(
      {
        'GET /premium': {
          accepts: {
            scheme: 'exact',
            network: BASE_SEPOLIA_NETWORK,
            payTo: getAddress(payTo),
            price: {
              asset: BASE_SEPOLIA_USDC,
              amount: amount.toString(),
              extra: {
                name: BASE_SEPOLIA_USDC_EIP712_NAME,
                version: BASE_SEPOLIA_USDC_EIP712_VERSION,
              },
            },
            extra: {
              assetTransferMethod: 'eip3009',
              paymentFlow: 'authorization',
            },
          },
          description: 'Pact Milestone 2 standard x402 resource',
          mimeType: 'application/json',
          unpaidResponseBody: () => ({
            contentType: 'application/json',
            body: { error: 'payment_required' },
          }),
        },
      },
      resourceServer,
    ),
  )
  app.get('/premium', (_request, response) => {
    response.status(200).json({ premiumData: 'hello' })
  })

  return app
}
