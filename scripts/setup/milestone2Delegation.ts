import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { bytesToHex, createPublicClient, http, isHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

import {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_USDC,
  ONE_DAY_SECONDS,
  ONE_USDC,
  createTreasuryAgentDelegation,
  createTreasury,
  toStoredTreasuryAgentDelegation,
} from '../../src/index.js'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}.`)
  return value
}

function account(name: string) {
  const value = required(name)
  if (!isHex(value) || value.length !== 66) {
    throw new Error(`${name} must be a 32-byte 0x-prefixed private key.`)
  }
  return privateKeyToAccount(value)
}

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(required('BASE_SEPOLIA_RPC_URL')),
})
const alice = account('ALICE_PRIVATE_KEY')
const bob = account('BOB_PRIVATE_KEY')
const carol = account('CAROL_PRIVATE_KEY')
const agentSession = account('AGENT_SESSION_PRIVATE_KEY')
const chainId = await publicClient.getChainId()
if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
  throw new Error(`Expected Base Sepolia (${BASE_SEPOLIA_CHAIN_ID}), received ${chainId}.`)
}

const treasury = await createTreasury({
  client: publicClient,
  config: {
    owners: [alice.address, bob.address, carol.address],
    threshold: 2,
  },
  deploySalt: '0x4d696c6573746f6e6531',
})
const now = Math.floor(Date.now() / 1_000)
const authority = await createTreasuryAgentDelegation({
  treasury,
  agentSession: agentSession.address,
  ownerSigners: [alice, bob],
  salt: bytesToHex(randomBytes(32)),
  policy: {
    tokenAddress: BASE_SEPOLIA_USDC,
    periodAmount: ONE_USDC,
    periodDurationSeconds: ONE_DAY_SECONDS,
    startsAt: now - 60,
    expiresAt: now + 30 * ONE_DAY_SECONDS,
  },
})
const stored = await toStoredTreasuryAgentDelegation(authority)
const outputPath = resolve(
  process.env.MILESTONE2_DELEGATION_PATH ?? 'milestone2-delegation.json',
)

await writeFile(outputPath, `${JSON.stringify(stored, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
})
console.log('Created an off-chain ERC-7710 root delegation signed by Alice and Bob.')
console.log('Treasury:', treasury.address)
console.log('AgentSession:', agentSession.address)
console.log('Daily USDC authority:', stored.policy.periodAmount)
console.log('Delegation artifact:', outputPath)
