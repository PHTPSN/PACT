import 'dotenv/config'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { getSmartAccountsEnvironment } from '@metamask/smart-accounts-kit'
import { getAddress, isHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import {
  BASE_SEPOLIA_CHAIN_ID,
  ONE_USDC,
  createPaidFetch,
  type StoredTreasuryAgentDelegation,
} from '../../src/index.js'

const privateKey = process.env.AGENT_SESSION_PRIVATE_KEY
if (!privateKey || !isHex(privateKey) || privateKey.length !== 66) {
  throw new Error('AGENT_SESSION_PRIVATE_KEY must be a 32-byte 0x-prefixed key.')
}
const artifactPath = resolve(
  process.env.MILESTONE2_DELEGATION_PATH ?? 'milestone2-delegation.json',
)
const authority = JSON.parse(
  await readFile(artifactPath, 'utf8'),
) as StoredTreasuryAgentDelegation
if (authority.version !== 1 || authority.chainId !== BASE_SEPOLIA_CHAIN_ID) {
  throw new Error('The root delegation artifact is not for Base Sepolia Milestone 2.')
}

const agentAccount = privateKeyToAccount(privateKey)
if (agentAccount.address.toLowerCase() !== authority.agentSession.toLowerCase()) {
  throw new Error('AGENT_SESSION_PRIVATE_KEY does not match the delegated AgentSession.')
}
const paidFetch = createPaidFetch({
  agentAccount,
  rootPermissionContext: authority.permissionContext,
  environment: getSmartAccountsEnvironment(BASE_SEPOLIA_CHAIN_ID),
  maximumPaymentAmount: BigInt(
    process.env.MILESTONE2_CLIENT_MAX_ATOMIC ?? ONE_USDC,
  ),
  facilitatorAddresses: [
    getAddress(
      privateKeyToAccount(
        (process.env.MILESTONE2_FACILITATOR_PRIVATE_KEY ??
          process.env.OUTSIDER_PRIVATE_KEY) as `0x${string}`,
      ).address,
    ),
  ],
})
const endpoint =
  process.env.MILESTONE2_PREMIUM_URL ?? 'http://127.0.0.1:4021/premium'
const result = await paidFetch<{ premiumData: string }>(endpoint, {
  headers: { accept: 'application/json' },
})
const output = {
  milestone: 2,
  endpoint,
  resource: result.resource,
  settlement: result.settlement,
  audit: result.audit,
}
const resultPath = resolve(
  process.env.MILESTONE2_RESULT_PATH ?? 'milestone2-result.json',
)

await writeFile(resultPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(output, null, 2))
