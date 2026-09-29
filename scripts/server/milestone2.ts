import 'dotenv/config'

import { isAddress } from 'viem'

import { TEN_CENTS_USDC, createPremiumServer } from '../../src/index.js'

const payTo = process.env.MILESTONE2_PAY_TO_ADDRESS
if (!payTo || !isAddress(payTo)) {
  throw new Error('MILESTONE2_PAY_TO_ADDRESS must be a valid Base Sepolia address.')
}
if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET) {
  throw new Error('CDP_API_KEY_ID and CDP_API_KEY_SECRET must be configured.')
}
const port = Number(process.env.MILESTONE2_SERVER_PORT ?? '4021')
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error('MILESTONE2_SERVER_PORT must be an integer between 1 and 65535.')
}
const amount = BigInt(process.env.MILESTONE2_PRICE_ATOMIC ?? TEN_CENTS_USDC)
const app = createPremiumServer({ payTo, amount })

app.listen(port, '127.0.0.1', () => {
  console.log(`Milestone 2 x402 resource: http://127.0.0.1:${port}/premium`)
  console.log('Facilitator: Coinbase CDP hosted facilitator')
  console.log('Network: eip155:84532 (Base Sepolia)')
  console.log('Asset transfer: EIP-3009 authorization')
  console.log('Price (atomic USDC):', amount.toString())
})
