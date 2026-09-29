import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { createPublicClient, http, isHex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

import { createTreasury } from '../../src/treasury/index.js'

const envPath = resolve('.env')
const original = await readFile(envPath, 'utf8').catch(() => '')
const entries = new Map<string, string>()
const order: string[] = []

for (const rawLine of original.split(/\r?\n/u)) {
  const line = rawLine.trim()
  if (!line || line.startsWith('#') || !line.includes('=')) continue
  const separator = line.indexOf('=')
  const key = line.slice(0, separator)
  const value = line.slice(separator + 1)
  entries.set(key, value)
  order.push(key)
}

const keyNames = [
  'ALICE_PRIVATE_KEY',
  'BOB_PRIVATE_KEY',
  'CAROL_PRIVATE_KEY',
  'AGENT_SESSION_PRIVATE_KEY',
  'OUTSIDER_PRIVATE_KEY',
] as const

if (!entries.get('BASE_SEPOLIA_RPC_URL')) {
  entries.set('BASE_SEPOLIA_RPC_URL', 'https://sepolia.base.org')
}

for (const name of keyNames) {
  const current = entries.get(name)
  if (!current) {
    entries.set(name, generatePrivateKey())
  } else if (!isHex(current) || current.length !== 66) {
    throw new Error(`${name} exists but is not a 32-byte 0x-prefixed key.`)
  }
}

if (!entries.has('BASE_SEPOLIA_BUNDLER_URL')) {
  entries.set('BASE_SEPOLIA_BUNDLER_URL', '')
}
if (!entries.get('MILESTONE1_RESULT_PATH')) {
  entries.set('MILESTONE1_RESULT_PATH', 'milestone1-result.json')
}

const canonicalOrder = [
  'BASE_SEPOLIA_RPC_URL',
  'BASE_SEPOLIA_BUNDLER_URL',
  ...keyNames,
  'MILESTONE1_RESULT_PATH',
]
const outputOrder = [...new Set([...canonicalOrder, ...order])]
await writeFile(
  envPath,
  `${outputOrder.map((name) => `${name}=${entries.get(name) ?? ''}`).join('\n')}\n`,
  { encoding: 'utf8', mode: 0o600 },
)

const accounts = Object.fromEntries(
  keyNames.map((name) => [
    name.replace('_PRIVATE_KEY', '').toLowerCase(),
    privateKeyToAccount(entries.get(name) as `0x${string}`),
  ]),
) as Record<string, ReturnType<typeof privateKeyToAccount>>

const alice = accounts.alice
const bob = accounts.bob
const carol = accounts.carol
if (!alice || !bob || !carol) throw new Error('Failed to create owner accounts.')

const publicClient = createPublicClient({ chain: baseSepolia, transport: http() })
const treasury = await createTreasury({
  client: publicClient,
  config: {
    owners: [alice.address, bob.address, carol.address],
    threshold: 2,
  },
  deploySalt: '0x4d696c6573746f6e6531',
})

console.log('Generated or reused testnet-only identities; private keys are in .env.')
console.log('Alice:', alice.address)
console.log('Bob:', bob.address)
console.log('Carol:', carol.address)
console.log('AgentSession:', accounts.agent_session?.address)
console.log('Outsider:', accounts.outsider?.address)
console.log('Treasury to fund:', treasury.address)
console.log('Bundler URL still required:', !entries.get('BASE_SEPOLIA_BUNDLER_URL'))
