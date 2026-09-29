import 'dotenv/config'

import { createPublicClient, createWalletClient, http, isAddress, isHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

import {
  LocalErc7710Facilitator,
  TEN_CENTS_USDC,
  createPremiumServer,
} from '../../src/index.js'

const payTo = process.env.MILESTONE2_PAY_TO_ADDRESS
if (!payTo || !isAddress(payTo)) {
  throw new Error('MILESTONE2_PAY_TO_ADDRESS must be a valid Base Sepolia address.')
}
const port = Number(process.env.MILESTONE2_SERVER_PORT ?? '4021')
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error('MILESTONE2_SERVER_PORT must be an integer between 1 and 65535.')
}
const facilitatorKey =
  process.env.MILESTONE2_FACILITATOR_PRIVATE_KEY ?? process.env.OUTSIDER_PRIVATE_KEY
if (!facilitatorKey || !isHex(facilitatorKey) || facilitatorKey.length !== 66) {
  throw new Error(
    'MILESTONE2_FACILITATOR_PRIVATE_KEY or OUTSIDER_PRIVATE_KEY must be configured.',
  )
}
const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL
if (!rpcUrl) throw new Error('BASE_SEPOLIA_RPC_URL must be configured.')
const facilitatorAccount = privateKeyToAccount(facilitatorKey)
const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(rpcUrl),
})
const walletClient = createWalletClient({
  account: facilitatorAccount,
  chain: baseSepolia,
  transport: http(rpcUrl),
})
const facilitator = new LocalErc7710Facilitator({ publicClient, walletClient })
const amount = BigInt(process.env.MILESTONE2_PRICE_ATOMIC ?? TEN_CENTS_USDC)

const app = createPremiumServer({ payTo, facilitator, amount })
app.listen(port, () => {
  console.log(`Milestone 2 x402 resource listening at http://127.0.0.1:${port}/premium`)
  console.log('Price (atomic USDC):', amount.toString())
  console.log('Local facilitator:', facilitator.address)
})
