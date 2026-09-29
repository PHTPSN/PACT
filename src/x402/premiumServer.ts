import { x402ExactEvmErc7710ServerScheme } from '@metamask/x402'
import {
  HTTPFacilitatorClient,
  x402ResourceServer,
  type FacilitatorClient,
} from '@x402/core/server'
import { paymentMiddleware } from '@x402/express'
import express, { type Express } from 'express'
import { getAddress, type Address } from 'viem'

import {
  BASE_SEPOLIA_NETWORK,
  BASE_SEPOLIA_USDC,
  METAMASK_BASE_SEPOLIA_FACILITATOR_URL,
  TEN_CENTS_USDC,
} from './constants.js'

export type PremiumServerConfig = {
  payTo: Address
  amount?: bigint
  facilitatorUrl?: string
  facilitator?: FacilitatorClient
}

export function createPremiumServer({
  payTo,
  amount = TEN_CENTS_USDC,
  facilitatorUrl = METAMASK_BASE_SEPOLIA_FACILITATOR_URL,
  facilitator: suppliedFacilitator,
}: PremiumServerConfig): Express {
  if (amount <= 0n) throw new Error('Premium endpoint price must be positive.')

  const facilitator =
    suppliedFacilitator ?? new HTTPFacilitatorClient({ url: facilitatorUrl })
  const delegatedScheme = new x402ExactEvmErc7710ServerScheme()
  // @metamask/x402 1.0 predates the explicit payment-flow metadata added by
  // @x402/core 2.27. Advertise the adapter's ERC-7710 capability so the core
  // router can validate and retain the requested transfer method.
  Object.assign(delegatedScheme, {
    defaultAssetTransferMethod: 'erc7710',
    paymentFlows: {
      ...delegatedScheme.paymentFlows,
      erc7710: {
        supported: ['authorization'],
        default: 'authorization',
      },
    },
  })
  const resourceServer = new x402ResourceServer(facilitator).register(
    BASE_SEPOLIA_NETWORK,
    delegatedScheme,
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
            },
            extra: { assetTransferMethod: 'erc7710' },
          },
          description: 'Pact Milestone 2 delegated x402 resource',
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
