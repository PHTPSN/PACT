import { createPublicClient, http, isHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

import type { TreasurySigner } from '../../src/treasury/index.js'

const requiredNames = [
  'BASE_SEPOLIA_RPC_URL',
  'ALICE_PRIVATE_KEY',
  'BOB_PRIVATE_KEY',
  'CAROL_PRIVATE_KEY',
  'AGENT_WALLET_PRIVATE_KEY',
  'OUTSIDER_PRIVATE_KEY',
] as const

export const hasLiveEnvironment = requiredNames.every(name => process.env[name])

function required(name: (typeof requiredNames)[number]): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}.`)
  return value
}
function signer(name: (typeof requiredNames)[number]): TreasurySigner {
  const value = required(name)
  if (!isHex(value) || value.length !== 66) {
    throw new Error(`${name} must be a 32-byte 0x-prefixed private key.`)
  }
  const privateKey = value as `0x${string}`
  return { address: privateKeyToAccount(privateKey).address, privateKey }
}

export function loadLiveEnvironment() {
  const rpcUrl = required('BASE_SEPOLIA_RPC_URL')
  return {
    rpcUrl,
    publicClient: createPublicClient({
      chain: baseSepolia,
      transport: http(rpcUrl),
    }),
    alice: signer('ALICE_PRIVATE_KEY'),
    bob: signer('BOB_PRIVATE_KEY'),
    carol: signer('CAROL_PRIVATE_KEY'),
    agentWallet: signer('AGENT_WALLET_PRIVATE_KEY'),
    outsider: signer('OUTSIDER_PRIVATE_KEY'),
  }
}
