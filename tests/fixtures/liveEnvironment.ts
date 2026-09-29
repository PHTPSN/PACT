import { createBundlerClient } from 'viem/account-abstraction'
import { createPublicClient, http, isHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

import type {
  TreasuryBundlerClient,
  TreasurySigner,
} from '../../src/treasury/index.js'

const requiredNames = [
  'BASE_SEPOLIA_RPC_URL',
  'BASE_SEPOLIA_BUNDLER_URL',
  'ALICE_PRIVATE_KEY',
  'BOB_PRIVATE_KEY',
  'CAROL_PRIVATE_KEY',
  'AGENT_SESSION_PRIVATE_KEY',
  'OUTSIDER_PRIVATE_KEY',
] as const

export const hasLiveEnvironment = requiredNames.every((name) => process.env[name])

function required(name: (typeof requiredNames)[number]): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}.`)
  return value
}

function account(name: (typeof requiredNames)[number]) {
  const value = required(name)
  if (!isHex(value) || value.length !== 66) {
    throw new Error(`${name} must be a 32-byte 0x-prefixed private key.`)
  }
  return privateKeyToAccount(value)
}

export function loadLiveEnvironment() {
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(required('BASE_SEPOLIA_RPC_URL')),
  })
  const bundlerClient = createBundlerClient({
    client: publicClient,
    chain: baseSepolia,
    transport: http(required('BASE_SEPOLIA_BUNDLER_URL')),
  }) as TreasuryBundlerClient

  return {
    publicClient,
    bundlerClient,
    alice: account('ALICE_PRIVATE_KEY') as TreasurySigner,
    bob: account('BOB_PRIVATE_KEY') as TreasurySigner,
    carol: account('CAROL_PRIVATE_KEY') as TreasurySigner,
    agentSession: account('AGENT_SESSION_PRIVATE_KEY') as TreasurySigner,
    outsider: account('OUTSIDER_PRIVATE_KEY') as TreasurySigner,
  }
}
