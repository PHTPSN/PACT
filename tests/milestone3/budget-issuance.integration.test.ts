import 'dotenv/config'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createPublicClient,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  isHex,
  type Address,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import {
  InMemoryBudgetIssuer,
  SafeBudgetTreasuryAdapter,
  connectDeployedTreasury,
  type TreasurySigner,
} from '../../src/index.js'

const enabled = process.env.RUN_LIVE_M3 === 'true'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}.`)
  return value
}

function configuredRpcUrl(): string {
  return (
    process.env.RPC_URL ??
    process.env.BASE_SEPOLIA_RPC_URL ??
    required('RPC_URL')
  )
}

function address(name: string): Address {
  const value = required(name)
  if (!isAddress(value, { strict: false })) {
    throw new Error(`${name} must be an EVM address.`)
  }
  return getAddress(value)
}

function ownerSigners(): TreasurySigner[] {
  const entries = Object.entries(process.env)
    .flatMap(([name, value]) => {
      const match = /^OWNER_PRIVATE_KEY_(\d+)$/.exec(name)
      return match && value ? [{ index: Number(match[1]), name, value }] : []
    })
    .sort((left, right) => left.index - right.index)
  if (entries.length === 0) {
    throw new Error('At least OWNER_PRIVATE_KEY_1 must be configured.')
  }
  return entries.map(({ name, value }) => {
    return signer(name, value)
  })
}

function signer(name: string, value = required(name)): TreasurySigner {
  if (!isHex(value) || value.length !== 66) {
    throw new Error(`${name} must be a 32-byte 0x-prefixed private key.`)
  }
  const privateKey = value as `0x${string}`
  return { address: privateKeyToAccount(privateKey).address, privateKey }
}

async function tokenBalance(
  client: ReturnType<typeof createPublicClient>,
  token: Address,
  holder: Address,
): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [holder],
  })
}

describe.skipIf(!enabled)('Milestone 3 collective budget issuance', () => {
  it('moves the configured ERC-20 budget only after the deployed Safe threshold', async () => {
    const rpcUrl = configuredRpcUrl()
    const safeAddress = address('SAFE_ADDRESS')
    const agentWalletAddress = address('AGENT_WALLET_ADDRESS')
    const tokenAddress = address('TOKEN_ADDRESS')
    const tokenDecimals = Number(required('TOKEN_DECIMALS'))
    const amount = BigInt(required('BUDGET_AMOUNT_ATOMIC'))
    if (!Number.isSafeInteger(tokenDecimals) || tokenDecimals < 0) {
      throw new Error('TOKEN_DECIMALS must be a non-negative integer.')
    }
    if (amount <= 0n) throw new Error('BUDGET_AMOUNT_ATOMIC must be positive.')

    const publicClient = createPublicClient({ cacheTime: 0, transport: http(rpcUrl) })
    const chainId = await publicClient.getChainId()
    if (process.env.CHAIN_ID && chainId !== Number(process.env.CHAIN_ID)) {
      throw new Error(
        `RPC chain ${chainId} does not match configured CHAIN_ID ${process.env.CHAIN_ID}.`,
      )
    }
    const treasury = await connectDeployedTreasury({ provider: rpcUrl, safeAddress })
    const ownerSet = new Set(
      treasury.config.owners.map(owner => owner.toLowerCase()),
    )
    if (ownerSet.has(agentWalletAddress.toLowerCase())) {
      throw new Error('The configured Agent Wallet must not be a Safe owner.')
    }
    const signers = ownerSigners()
    const validOwnerSigners = signers.filter(signer =>
      ownerSet.has(signer.address.toLowerCase()),
    )
    if (validOwnerSigners.length < treasury.config.threshold) {
      throw new Error(
        `Only ${validOwnerSigners.length} configured key(s) match Safe owners; ${treasury.config.threshold} required.`,
      )
    }
    const actualDecimals = await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'decimals',
    })
    if (actualDecimals !== tokenDecimals) {
      throw new Error(
        `TOKEN_DECIMALS=${tokenDecimals} does not match the token contract value ${actualDecimals}.`,
      )
    }

    const adapter = new SafeBudgetTreasuryAdapter({
      treasury,
      signers,
      executor: process.env.EXECUTOR_PRIVATE_KEY
        ? signer('EXECUTOR_PRIVATE_KEY')
        : validOwnerSigners[0]!,
    })
    const issuer = new InMemoryBudgetIssuer({
      config: {
        agentWalletAddress,
        tokens: [
          {
            address: tokenAddress,
            symbol: process.env.TOKEN_SYMBOL ?? 'TOKEN',
            decimals: tokenDecimals,
          },
        ],
      },
      treasury: adapter,
    })
    const [safeBefore, agentBefore] = await Promise.all([
      tokenBalance(publicClient, tokenAddress, treasury.address),
      tokenBalance(publicClient, tokenAddress, agentWalletAddress),
    ])
    if (safeBefore < amount) {
      throw new Error(
        `Safe token balance ${safeBefore} is below requested budget ${amount}.`,
      )
    }

    let proposal = await issuer.createProposal({
      treasuryAddress: treasury.address,
      recipientAddress: agentWalletAddress,
      tokenAddress,
      tokenDecimals,
      amount,
      memo: process.env.BUDGET_MEMO ?? 'Milestone 3 live verification',
    })
    await expect(issuer.executeProposal(proposal.id)).rejects.toThrow()
    for (const signer of validOwnerSigners.slice(0, treasury.config.threshold)) {
      proposal = await issuer.approveProposal({
        proposalId: proposal.id,
        signer: signer.address,
      })
    }
    expect(proposal.status).toBe('ready')

    const executed = await issuer.executeProposal(proposal.id)
    if (!executed.executionTxHash) {
      throw new Error('Executed proposal omitted its transaction hash.')
    }
    const receipt = await publicClient.getTransactionReceipt({
      hash: executed.executionTxHash,
    })
    const [safeAfter, agentAfter] = await Promise.all([
      tokenBalance(publicClient, tokenAddress, treasury.address),
      tokenBalance(publicClient, tokenAddress, agentWalletAddress),
    ])
    const replay = await issuer.executeProposal(proposal.id)
    const [safeAfterReplay, agentAfterReplay] = await Promise.all([
      tokenBalance(publicClient, tokenAddress, treasury.address),
      tokenBalance(publicClient, tokenAddress, agentWalletAddress),
    ])

    const evidence = {
      milestone: 'collective-budget-issuance',
      chainId,
      safeAddress: treasury.address,
      owners: treasury.config.owners,
      threshold: treasury.config.threshold,
      agentWalletAddress,
      tokenAddress,
      tokenDecimals,
      amount: amount.toString(),
      proposalId: executed.id,
      safeTxHash: executed.safeTxHash,
      executionTxHash: executed.executionTxHash,
      approvals: executed.approvals,
      receiptStatus: receipt.status,
      balances: {
        safeBefore: safeBefore.toString(),
        safeAfter: safeAfter.toString(),
        agentBefore: agentBefore.toString(),
        agentAfter: agentAfter.toString(),
        safeAfterReplay: safeAfterReplay.toString(),
        agentAfterReplay: agentAfterReplay.toString(),
      },
      results: {
        thresholdReached: executed.approvals.length >= treasury.config.threshold,
        receiptSucceeded: receipt.status === 'success',
        exactSafeDelta: safeBefore - safeAfter === amount,
        exactAgentDelta: agentAfter - agentBefore === amount,
        replayReturnedSameTransaction:
          replay.executionTxHash === executed.executionTxHash,
        replayDidNotTransferAgain:
          safeAfterReplay === safeAfter && agentAfterReplay === agentAfter,
      },
    }
    await writeFile(
      resolve(process.env.MILESTONE3_RESULT_PATH ?? 'milestone3-result.json'),
      `${JSON.stringify(evidence, null, 2)}\n`,
      'utf8',
    )
    expect(Object.values(evidence.results).every(Boolean)).toBe(true)
  }, 300_000)
})
