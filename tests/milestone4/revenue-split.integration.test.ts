import 'dotenv/config'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  isHex,
  zeroAddress,
  type Address,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import {
  RevenueSplitService,
  SplitsV2PushSplitAdapter,
  calculateRevenueDistribution,
  minimumExactPushSplitFundingAmount,
  sortRevenueShares,
  validateRevenueSplitConfig,
  type RevenueAuditEvent,
} from '../../src/index.js'

const enabled = process.env.RUN_LIVE_M4 === 'true'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}.`)
  return value
}

function configuredRpcUrl(): string {
  return process.env.RPC_URL ?? process.env.BASE_SEPOLIA_RPC_URL ?? required('RPC_URL')
}

function address(name: string): Address {
  const value = required(name)
  if (!isAddress(value, { strict: false })) {
    throw new Error(`${name} must be an EVM address.`)
  }
  return getAddress(value)
}

function agentWalletAddress(): Address {
  if (process.env.AGENT_WALLET_ADDRESS) return address('AGENT_WALLET_ADDRESS')
  const privateKey = required('AGENT_WALLET_PRIVATE_KEY')
  if (!isHex(privateKey) || privateKey.length !== 66) {
    throw new Error(
      'AGENT_WALLET_PRIVATE_KEY must be a 32-byte 0x-prefixed key.',
    )
  }
  return privateKeyToAccount(privateKey as `0x${string}`).address
}

function addressList(name: string): Address[] {
  const values = required(name)
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  if (values.length === 0) throw new Error(`${name} must not be empty.`)
  return values.map((value, index) => {
    if (!isAddress(value, { strict: false })) {
      throw new Error(`${name}[${index}] must be an EVM address.`)
    }
    return getAddress(value)
  })
}

function allocationList(name: string): number[] {
  const values = required(name)
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  if (values.length === 0) throw new Error(`${name} must not be empty.`)
  return values.map((value, index) => {
    const allocation = Number(value)
    if (!Number.isSafeInteger(allocation)) {
      throw new Error(`${name}[${index}] must be an integer.`)
    }
    return allocation
  })
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

describe.skipIf(!enabled)('Milestone 4 protected economic rights', () => {
  it('creates an immutable PushSplit and distributes configured ERC-20 revenue', async () => {
    const rpcUrl = configuredRpcUrl()
    const tokenAddress = address('TOKEN_ADDRESS')
    const recipients = addressList('SPLIT_RECIPIENTS')
    const allocations = allocationList('SPLIT_ALLOCATIONS_BPS')
    if (recipients.length !== allocations.length) {
      throw new Error(
        'SPLIT_RECIPIENTS and SPLIT_ALLOCATIONS_BPS must have equal lengths.',
      )
    }
    const config = validateRevenueSplitConfig({
      recipients: recipients.map((recipient, index) => ({
        recipient,
        allocationBps: allocations[index]!,
      })),
      immutable: true,
    })
    const fundingAmount = minimumExactPushSplitFundingAmount(config.recipients)
    const planned = calculateRevenueDistribution(
      fundingAmount - 1n,
      config.recipients,
    )
    if (planned.roundingDust !== 0n) {
      throw new Error(
        'The internally derived live amount must divide exactly across the configured allocations.',
      )
    }

    const privateKey = required('OUTSIDER_PRIVATE_KEY')
    if (!isHex(privateKey) || privateKey.length !== 66) {
      throw new Error(
        'OUTSIDER_PRIVATE_KEY must be a 32-byte 0x-prefixed key.',
      )
    }
    const deployer = privateKeyToAccount(privateKey as `0x${string}`)
    const configuredAgentWallet = agentWalletAddress()
    const safeAddress = address('SAFE_ADDRESS')
    const publicClient = createPublicClient({ cacheTime: 0, transport: http(rpcUrl) })
    const walletClient = createWalletClient({
      account: deployer,
      transport: http(rpcUrl),
    })
    const chainId = await publicClient.getChainId()
    if (
      process.env.CHAIN_ID &&
      (!Number.isSafeInteger(Number(process.env.CHAIN_ID)) ||
        Number(process.env.CHAIN_ID) !== chainId)
    ) {
      throw new Error(
        `RPC chain ${chainId} does not match configured CHAIN_ID ${process.env.CHAIN_ID}.`,
      )
    }
    const actualDecimals = await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'decimals',
    })
    if (
      process.env.TOKEN_DECIMALS &&
      actualDecimals !== Number(process.env.TOKEN_DECIMALS)
    ) {
      throw new Error(
        `TOKEN_DECIMALS=${process.env.TOKEN_DECIMALS} does not match contract value ${actualDecimals}.`,
      )
    }
    const tokenDecimals = actualDecimals
    const deployerBalance = await tokenBalance(
      publicClient,
      tokenAddress,
      deployer.address,
    )
    if (deployerBalance < fundingAmount) {
      throw new Error(
        `Split deployer token balance ${deployerBalance} is below ${fundingAmount}.`,
      )
    }

    const audit: RevenueAuditEvent[] = []
    const adapter = new SplitsV2PushSplitAdapter({
      chainId,
      rpcUrl,
      deployer,
    })
    const service = new RevenueSplitService({
      adapter,
      audit: event => audit.push(event),
    })
    const created = await service.createImmutableSplit(config)
    const actual = await service.getSplit(created.address)
    const expectedShares = sortRevenueShares(config.recipients)
    expect(actual.recipients).toEqual(expectedShares)
    expect(actual.immutable).toBe(true)

    const splitBeforeFunding = await tokenBalance(
      publicClient,
      tokenAddress,
      actual.address,
    )
    const fundingTxHash = await walletClient.writeContract({
      account: deployer,
      chain: null,
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [actual.address, fundingAmount],
    })
    const fundingReceipt = await publicClient.waitForTransactionReceipt({
      hash: fundingTxHash,
    })
    if (fundingReceipt.status !== 'success') {
      throw new Error('Revenue funding transfer reverted.')
    }
    let splitAfterFunding = splitBeforeFunding
    for (let attempt = 0; attempt < 15; attempt += 1) {
      splitAfterFunding = await tokenBalance(publicClient, tokenAddress, actual.address)
      if (splitAfterFunding - splitBeforeFunding === fundingAmount) break
      await new Promise(resolveWait => setTimeout(resolveWait, 1_000))
    }
    expect(splitAfterFunding - splitBeforeFunding).toBe(fundingAmount)

    const protectedAddresses = [...new Map(
      [configuredAgentWallet, safeAddress, deployer.address].map(value => [
        value.toLowerCase(),
        value,
      ]),
    ).values()]
    const protectedBefore = await Promise.all(
      protectedAddresses.map(holder => tokenBalance(publicClient, tokenAddress, holder)),
    )
    const distribution = await service.distributeToken({
      splitAddress: actual.address,
      tokenAddress,
    })
    const protectedAfter = await Promise.all(
      protectedAddresses.map(holder => tokenBalance(publicClient, tokenAddress, holder)),
    )
    const expected = calculateRevenueDistribution(
      distribution.amountDistributed,
      actual.recipients,
    )
    expect(distribution.amountDistributed).toBe(fundingAmount - 1n)
    expect(distribution.recipientDeltas).toEqual(expected.recipientDeltas)
    expect(expected.roundingDust).toBe(0n)

    const protectedResults = protectedAddresses.map((holder, index) => {
      const configuredShare = actual.recipients.find(
        share => share.recipient.toLowerCase() === holder.toLowerCase(),
      )
      const expectedDelta = configuredShare
        ? (distribution.amountDistributed * BigInt(configuredShare.allocationBps)) /
          10_000n
        : 0n
      const actualDelta = protectedAfter[index]! - protectedBefore[index]!
      return {
        address: holder,
        explicitlyConfigured: Boolean(configuredShare),
        expectedDelta,
        actualDelta,
        noUnexpectedRevenue: actualDelta === expectedDelta,
        hasControl: false,
      }
    })
    expect(protectedResults.every(result => result.noUnexpectedRevenue)).toBe(true)

    const evidence = {
      milestone: 'protected-economic-rights',
      architecture: 'splits-v2.2-push-split',
      chainId,
      splitAddress: actual.address,
      immutable: actual.immutable,
      immutabilityEvidence: {
        owner: zeroAddress,
        splitHashMatchedAuthoritativeEvent: true,
        implementation: 'PushSplit V2.2',
      },
      recipients: actual.recipients,
      tokenAddress,
      tokenDecimals,
      fundingAmount: fundingAmount.toString(),
      amountDistributed: distribution.amountDistributed.toString(),
      retainedBalance: distribution.splitBalanceAfter.toString(),
      creationTxHash: actual.creationTxHash,
      fundingTxHash,
      distributionTxHash: distribution.txHash,
      recipientDeltas: distribution.recipientDeltas.map(delta => ({
        recipient: delta.recipient,
        amount: delta.amount.toString(),
      })),
      protectedAddresses: protectedResults.map(result => ({
        ...result,
        expectedDelta: result.expectedDelta.toString(),
        actualDelta: result.actualDelta.toString(),
      })),
      audit: audit.map(event => ({
        ...event,
        ...('amount' in event ? { amount: event.amount.toString() } : {}),
        ...('recipientDeltas' in event
          ? {
              recipientDeltas: event.recipientDeltas.map(delta => ({
                recipient: delta.recipient,
                amount: delta.amount.toString(),
              })),
            }
          : {}),
      })),
      results: {
        authoritativeConfigurationMatched: true,
        immutableOwnerVerified: true,
        exactFundingDelta: splitAfterFunding - splitBeforeFunding === fundingAmount,
        exactRecipientDeltas: distribution.recipientDeltas.every(
          (delta, index) => delta.amount === expected.recipientDeltas[index]!.amount,
        ),
        zeroRoundingDust: expected.roundingDust === 0n,
        protectedAddressesIsolated: protectedResults.every(
          result => result.noUnexpectedRevenue && !result.hasControl,
        ),
      },
    }
    await writeFile(
      resolve(process.env.MILESTONE4_RESULT_PATH ?? 'milestone4-result.json'),
      `${JSON.stringify(evidence, null, 2)}\n`,
      'utf8',
    )
    expect(Object.values(evidence.results).every(Boolean)).toBe(true)
  }, 300_000)
})
