import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { isHex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

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
  entries.set(key, line.slice(separator + 1))
  order.push(key)
}

if (!entries.get('AGENT_WALLET_PRIVATE_KEY') && entries.get('AGENT_SESSION_PRIVATE_KEY')) {
  entries.set('AGENT_WALLET_PRIVATE_KEY', entries.get('AGENT_SESSION_PRIVATE_KEY') as string)
}
entries.delete('AGENT_SESSION_PRIVATE_KEY')

const keyNames = [
  'ALICE_PRIVATE_KEY',
  'BOB_PRIVATE_KEY',
  'CAROL_PRIVATE_KEY',
  'AGENT_WALLET_PRIVATE_KEY',
  'OUTSIDER_PRIVATE_KEY',
] as const

if (!entries.get('BASE_SEPOLIA_RPC_URL')) {
  entries.set('BASE_SEPOLIA_RPC_URL', 'https://sepolia.base.org')
}
for (const name of keyNames) {
  const current = entries.get(name)
  if (!current) entries.set(name, generatePrivateKey())
  else if (!isHex(current) || current.length !== 66) {
    throw new Error(`${name} exists but is not a 32-byte 0x-prefixed key.`)
  }
}
if (!entries.get('MILESTONE1_RESULT_PATH')) {
  entries.set('MILESTONE1_RESULT_PATH', 'milestone1-result.json')
}

const canonicalOrder = [
  'BASE_SEPOLIA_RPC_URL',
  ...keyNames,
  'CDP_API_KEY_ID',
  'CDP_API_KEY_SECRET',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'MILESTONE1_RESULT_PATH',
]
const outputOrder = [
  ...new Set([
    ...canonicalOrder,
    ...order.filter(name => name !== 'AGENT_SESSION_PRIVATE_KEY'),
  ]),
]
await writeFile(
  envPath,
  `${outputOrder.map(name => `${name}=${entries.get(name) ?? ''}`).join('\n')}\n`,
  { encoding: 'utf8', mode: 0o600 },
)

const account = (name: (typeof keyNames)[number]) =>
  privateKeyToAccount(entries.get(name) as `0x${string}`)
const alice = account('ALICE_PRIVATE_KEY')
const bob = account('BOB_PRIVATE_KEY')
const carol = account('CAROL_PRIVATE_KEY')
const agentWallet = account('AGENT_WALLET_PRIVATE_KEY')
const outsider = account('OUTSIDER_PRIVATE_KEY')
const treasury = await createTreasury({
  provider: entries.get('BASE_SEPOLIA_RPC_URL') as string,
  config: {
    owners: [alice.address, bob.address, carol.address],
    threshold: 2,
  },
})

console.log('Generated or reused testnet-only identities; private keys remain in .env.')
console.log('Alice:', alice.address)
console.log('Bob:', bob.address)
console.log('Carol:', carol.address)
console.log('Agent Wallet:', agentWallet.address)
console.log('Outsider:', outsider.address)
console.log('Predicted Safe:', treasury.address)
