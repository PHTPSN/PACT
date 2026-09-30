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

export const PREMIUM_MARKET_BRIEF = Object.freeze({
  reportId: 'pact-market-brief-2026-q3',
  title: 'Autonomous Agent Launch Market Brief',
  asOf: '2026-09-29',
  markets: [
    {
      market: 'Seoul',
      developerAdoptionScore: 92,
      paidAgentReadinessScore: 89,
      estimatedAcquisitionCostUsd: 42,
    },
    {
      market: 'Singapore',
      developerAdoptionScore: 84,
      paidAgentReadinessScore: 86,
      estimatedAcquisitionCostUsd: 58,
    },
    {
      market: 'Tokyo',
      developerAdoptionScore: 79,
      paidAgentReadinessScore: 74,
      estimatedAcquisitionCostUsd: 71,
    },
  ],
  recommendation: {
    primaryMarket: 'Seoul',
    rationale:
      'Highest combined developer adoption and paid-agent readiness with acquisition cost below the cohort median.',
  },
  methodology:
    'Deterministic demo dataset for validating paid-resource use in the Pact Qwen workflow.',
})
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
    response.status(200).json(PREMIUM_MARKET_BRIEF)
  })

  return app
}
