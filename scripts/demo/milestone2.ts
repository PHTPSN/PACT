import 'dotenv/config'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { getAddress, isHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import {
  BASE_SEPOLIA_NETWORK,
  BASE_SEPOLIA_USDC,
  ONE_USDC,
  createPaidFetch,
} from '../../src/index.js'

const privateKey = process.env.AGENT_WALLET_PRIVATE_KEY
if (!privateKey || !isHex(privateKey) || privateKey.length !== 66) {
  throw new Error('AGENT_WALLET_PRIVATE_KEY must be a 32-byte 0x-prefixed key.')
}
const payTo = process.env.MILESTONE2_PAY_TO_ADDRESS
if (!payTo) throw new Error('MILESTONE2_PAY_TO_ADDRESS must be configured.')

const agentWalletAccount = privateKeyToAccount(privateKey)
const paidFetch = createPaidFetch({
  agentWalletAccount,
  maximumPaymentAmount: BigInt(
    process.env.MILESTONE2_CLIENT_MAX_ATOMIC ?? ONE_USDC,
  ),
  expectedPayTo: getAddress(payTo),
})
const endpoint =
  process.env.MILESTONE2_PREMIUM_URL ?? 'http://127.0.0.1:4021/premium'
const result = await paidFetch<{ premiumData: string }>(endpoint, {
  headers: { accept: 'application/json' },
})
const output = {
  milestone: 2,
  endpoint,
  architecture: {
    payer: 'standalone-agent-wallet',
    facilitator: 'coinbase-cdp-hosted',
    protocolVersion: 2,
    scheme: 'exact',
    network: BASE_SEPOLIA_NETWORK,
    asset: BASE_SEPOLIA_USDC,
    authorizationMethod: 'eip3009',
    paymentFlow: 'authorization',
  },
  agentWallet: agentWalletAccount.address,
  payTo: getAddress(payTo),
  resource: result.resource,
  settlement: result.settlement,
  audit: result.audit,
}
const resultPath = resolve(
  process.env.MILESTONE2_RESULT_PATH ?? 'milestone2-result.json',
)

await writeFile(resultPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(output, null, 2))
