import { SPLITS_V2_SUPPORTED_CHAIN_IDS } from '@0xsplits/splits-sdk'
import { getSplitV2o2FactoryAddress } from '@0xsplits/splits-sdk/constants'
import {
  splitV2ABI,
  splitV2o2FactoryAbi,
} from '@0xsplits/splits-sdk/constants/abi'
import { SplitV2Type } from '@0xsplits/splits-sdk/types'
import {
  getMaxSplitV2Recipients,
  getSplitV2TypeFromBytecode,
} from '@0xsplits/splits-sdk/utils'
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeAbiParameters,
  erc20Abi,
  getAddress,
  http,
  keccak256,
  parseAbi,
  zeroAddress,
  type Address,
  type Hash,
  type LocalAccount,
} from 'viem'

import type { RevenueSplitAdapter } from './adapter.js'
import {
  calculateRevenueDistribution,
  pushSplitDistributableBalance,
} from './arithmetic.js'
import { RevenueSplitProtocolError } from './errors.js'
import type {
  RevenueDistributionResult,
  RevenueShare,
  RevenueSplit,
  RevenueSplitConfig,
} from './types.js'
import {
  FULL_OWNERSHIP_BPS,
  sortRevenueShares,
  validateRevenueAddress,
  validateRevenueSplitConfig,
} from './validation.js'

const splitTuple = {
  type: 'tuple',
  components: [
    { name: 'recipients', type: 'address[]' },
    { name: 'allocations', type: 'uint256[]' },
    { name: 'totalAllocation', type: 'uint256' },
    { name: 'distributionIncentive', type: 'uint16' },
  ],
} as const

// The official SDK's V2.2 ABI currently omits this public storage getter even
// though it is part of SplitWalletV2. Keep the minimal fragment local and use
// the SDK ABI for every other protocol call and event.
const updateBlockNumberAbi = parseAbi([
  'function updateBlockNumber() view returns (uint256)',
])

type ProtocolSplit = {
  recipients: readonly Address[]
  allocations: readonly bigint[]
  totalAllocation: bigint
  distributionIncentive: number
}

function protocolSplit(recipients: readonly RevenueShare[]): ProtocolSplit {
  const sorted = sortRevenueShares(recipients)
  return {
    recipients: sorted.map(share => share.recipient),
    allocations: sorted.map(share => BigInt(share.allocationBps)),
    totalAllocation: BigInt(FULL_OWNERSHIP_BPS),
    distributionIncentive: 0,
  }
}

function hashProtocolSplit(split: ProtocolSplit): Hash {
  return keccak256(encodeAbiParameters([splitTuple], [split]))
}

export class SplitsV2PushSplitAdapter implements RevenueSplitAdapter {
  readonly #chainId: number
  readonly #deployer: LocalAccount
  readonly #publicClient
  readonly #walletClient

  constructor({
    chainId,
    rpcUrl,
    deployer,
  }: {
    chainId: number
    rpcUrl: string
    deployer: LocalAccount
  }) {
    if (!SPLITS_V2_SUPPORTED_CHAIN_IDS.includes(chainId)) {
      throw new RevenueSplitProtocolError(
        `Splits V2 is not supported on configured chain ${chainId}.`,
      )
    }
    if (!rpcUrl.trim()) {
      throw new RevenueSplitProtocolError('A revenue split RPC URL is required.')
    }
    this.#chainId = chainId
    this.#deployer = deployer
    this.#publicClient = createPublicClient({
      cacheTime: 0,
      transport: http(rpcUrl),
    })
    this.#walletClient = createWalletClient({
      account: deployer,
      transport: http(rpcUrl),
    })
  }

  async createImmutableSplit(config: RevenueSplitConfig): Promise<RevenueSplit> {
    const validated = validateRevenueSplitConfig(config)
    const maxRecipients = getMaxSplitV2Recipients(SplitV2Type.Push)
    if (validated.recipients.length > maxRecipients) {
      throw new RevenueSplitProtocolError(
        `PushSplit supports at most ${maxRecipients} recipients.`,
      )
    }
    await this.#assertChain()
    const split = protocolSplit(validated.recipients)
    const factory = getSplitV2o2FactoryAddress(
      this.#chainId,
      SplitV2Type.Push,
    )
    const txHash = await this.#walletClient.writeContract({
      account: this.#deployer,
      chain: null,
      address: factory,
      abi: splitV2o2FactoryAbi,
      functionName: 'createSplit',
      args: [split, zeroAddress, zeroAddress],
    })
    const receipt = await this.#publicClient.waitForTransactionReceipt({
      hash: txHash,
    })
    if (receipt.status !== 'success') {
      throw new RevenueSplitProtocolError('PushSplit creation reverted.')
    }
    let splitAddress: Address | undefined
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== factory.toLowerCase()) continue
      try {
        const decoded = decodeEventLog({
          abi: splitV2o2FactoryAbi,
          data: log.data,
          topics: log.topics,
        })
        if (decoded.eventName === 'SplitCreated') {
          if (
            decoded.args.owner.toLowerCase() !== zeroAddress ||
            decoded.args.creator.toLowerCase() !== zeroAddress
          ) {
            throw new RevenueSplitProtocolError(
              'PushSplit factory event retained an owner or creator identity.',
            )
          }
          const eventSplit: ProtocolSplit = {
            recipients: decoded.args.splitParams.recipients,
            allocations: decoded.args.splitParams.allocations,
            totalAllocation: decoded.args.splitParams.totalAllocation,
            distributionIncentive:
              decoded.args.splitParams.distributionIncentive,
          }
          if (hashProtocolSplit(eventSplit) !== hashProtocolSplit(split)) {
            throw new RevenueSplitProtocolError(
              'PushSplit factory event did not match the requested ownership.',
            )
          }
          splitAddress = getAddress(decoded.args.split)
          break
        }
      } catch (error) {
        if (error instanceof RevenueSplitProtocolError) throw error
        // Ignore unrelated factory events in the same receipt.
      }
    }
    if (!splitAddress) {
      throw new RevenueSplitProtocolError(
        'The official PushSplit factory receipt omitted SplitCreated.',
      )
    }
    const created = await this.getSplit(splitAddress)
    if (created.creationTxHash !== txHash) {
      throw new RevenueSplitProtocolError(
        'The authoritative split creation event did not match its transaction.',
      )
    }
    return created
  }

  async getSplit(splitAddress: Address): Promise<RevenueSplit> {
    const address = validateRevenueAddress(splitAddress, 'Revenue split address')
    await this.#assertChain()
    let code = await this.#publicClient.getCode({ address })
    for (let attempt = 0; attempt < 15 && (!code || code === '0x'); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1_000))
      code = await this.#publicClient.getCode({ address })
    }
    if (!code || code === '0x') {
      throw new RevenueSplitProtocolError(`No split contract exists at ${address}.`)
    }
    let splitType: SplitV2Type
    try {
      splitType = getSplitV2TypeFromBytecode(code)
    } catch {
      throw new RevenueSplitProtocolError(
        `Contract ${address} is not a recognized official V2 Split.`,
      )
    }
    if (splitType !== SplitV2Type.Push) {
      throw new RevenueSplitProtocolError(
        `Split ${address} is not an official V2 PushSplit.`,
      )
    }
    const [owner, storedHash, updateBlockNumber, domain] = await Promise.all([
      this.#publicClient.readContract({
        address,
        abi: splitV2ABI,
        functionName: 'owner',
      }),
      this.#publicClient.readContract({
        address,
        abi: splitV2ABI,
        functionName: 'splitHash',
      }),
      this.#publicClient.readContract({
        address,
        abi: updateBlockNumberAbi,
        functionName: 'updateBlockNumber',
      }),
      this.#publicClient.readContract({
        address,
        abi: splitV2ABI,
        functionName: 'eip712Domain',
      }),
    ])
    if (domain[2] !== '2.2') {
      throw new RevenueSplitProtocolError(
        `Split ${address} is not the selected V2.2 implementation.`,
      )
    }
    const splitUpdatedEvent = splitV2ABI.find(
      item => item.type === 'event' && item.name === 'SplitUpdated',
    )!
    let logs = await this.#publicClient.getLogs({
      address,
      event: splitUpdatedEvent,
      fromBlock: updateBlockNumber,
      toBlock: updateBlockNumber,
    })
    for (let attempt = 0; attempt < 15 && logs.length === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1_000))
      logs = await this.#publicClient.getLogs({
        address,
        event: splitUpdatedEvent,
        fromBlock: updateBlockNumber,
        toBlock: updateBlockNumber,
      })
    }
    const latest = logs.at(-1)
    if (!latest || latest.eventName !== 'SplitUpdated') {
      throw new RevenueSplitProtocolError(
        `Split ${address} has no authoritative configuration event at block ${updateBlockNumber}.`,
      )
    }
    const onchain = latest.args._split
    if (!onchain) {
      throw new RevenueSplitProtocolError('SplitUpdated omitted its configuration.')
    }
    const readSplit: ProtocolSplit = {
      recipients: onchain.recipients.map(recipient => getAddress(recipient)),
      allocations: [...onchain.allocations],
      totalAllocation: onchain.totalAllocation,
      distributionIncentive: onchain.distributionIncentive,
    }
    if (hashProtocolSplit(readSplit) !== storedHash) {
      throw new RevenueSplitProtocolError(
        'The authoritative SplitUpdated configuration does not match splitHash().',
      )
    }
    if (owner.toLowerCase() !== zeroAddress) {
      throw new RevenueSplitProtocolError(
        `Split ${address} is mutable because owner() is ${owner}.`,
      )
    }
    if (readSplit.distributionIncentive !== 0) {
      throw new RevenueSplitProtocolError(
        'Pact revenue splits must not divert revenue to a distributor incentive.',
      )
    }
    if (readSplit.totalAllocation !== BigInt(FULL_OWNERSHIP_BPS)) {
      throw new RevenueSplitProtocolError(
        'The on-chain split does not represent 10,000 basis points of ownership.',
      )
    }
    const recipients = readSplit.recipients.map((recipient, index) => {
      const allocation = readSplit.allocations[index]
      if (allocation === undefined || allocation > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RevenueSplitProtocolError('The on-chain allocation is invalid.')
      }
      return {
        recipient,
        allocationBps: Number(allocation),
      }
    })
    const validated = validateRevenueSplitConfig({
      recipients,
      immutable: true,
    })
    const block = await this.#publicClient.getBlock({
      blockNumber: updateBlockNumber,
    })
    return Object.freeze({
      id: `${this.#chainId}:${address.toLowerCase()}`,
      chainId: this.#chainId,
      address,
      recipients: validated.recipients,
      immutable: true,
      ...(latest.transactionHash
        ? { creationTxHash: latest.transactionHash }
        : {}),
      createdAt: new Date(Number(block.timestamp) * 1_000).toISOString(),
    })
  }

  async distributeToken({
    splitAddress,
    tokenAddress,
  }: {
    splitAddress: Address
    tokenAddress: Address
  }): Promise<RevenueDistributionResult> {
    const split = await this.getSplit(splitAddress)
    const token = validateRevenueAddress(tokenAddress, 'Revenue token address')
    const protocol = protocolSplit(split.recipients)
    const recipientBalancesBefore = await Promise.all(
      split.recipients.map(share => this.#tokenBalance(token, share.recipient)),
    )
    const [{ splitBalance, warehouseBalance }] = await Promise.all([
      this.#splitBalances(split.address, token),
    ])
    const amountDistributed = pushSplitDistributableBalance(
      splitBalance,
      warehouseBalance,
    )
    if (amountDistributed <= 0n) {
      throw new RevenueSplitProtocolError(
        'The PushSplit has no distributable token balance.',
      )
    }
    const expected = calculateRevenueDistribution(
      amountDistributed,
      split.recipients,
    )
    const txHash = await this.#walletClient.writeContract({
      account: this.#deployer,
      chain: null,
      address: split.address,
      abi: splitV2ABI,
      functionName: 'distribute',
      args: [protocol, token, this.#deployer.address],
    })
    const receipt = await this.#publicClient.waitForTransactionReceipt({
      hash: txHash,
    })
    if (receipt.status !== 'success') {
      throw new RevenueSplitProtocolError('PushSplit distribution reverted.')
    }
    let emittedAmount: bigint | undefined
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== split.address.toLowerCase()) continue
      try {
        const decoded = decodeEventLog({
          abi: splitV2ABI,
          data: log.data,
          topics: log.topics,
        })
        if (
          decoded.eventName === 'SplitDistributed' &&
          getAddress(decoded.args.token) === token
        ) {
          emittedAmount = decoded.args.amount
          break
        }
      } catch {
        // Ignore unrelated Split events in the same receipt.
      }
    }
    if (emittedAmount !== amountDistributed) {
      throw new RevenueSplitProtocolError(
        'SplitDistributed did not confirm the expected distributed amount.',
      )
    }

    let recipientBalancesAfter = recipientBalancesBefore
    let splitBalanceAfter = splitBalance
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const [balances, currentSplitBalance] = await Promise.all([
        Promise.all(
          split.recipients.map(share =>
            this.#tokenBalance(token, share.recipient),
          ),
        ),
        this.#tokenBalance(token, split.address),
      ])
      recipientBalancesAfter = balances
      splitBalanceAfter = currentSplitBalance
      if (
        expected.recipientDeltas.every(
          (delta, index) =>
            balances[index]! - recipientBalancesBefore[index]! === delta.amount,
        )
      ) {
        break
      }
      await new Promise(resolve => setTimeout(resolve, 1_000))
    }
    const recipientDeltas = Object.freeze(
      split.recipients.map((share, index) => ({
        recipient: share.recipient,
        amount: recipientBalancesAfter[index]! - recipientBalancesBefore[index]!,
      })),
    )
    if (
      recipientDeltas.some(
        (delta, index) => delta.amount !== expected.recipientDeltas[index]!.amount,
      )
    ) {
      throw new RevenueSplitProtocolError(
        'Recipient balance deltas did not match PushSplit integer allocation semantics.',
      )
    }
    return Object.freeze({
      splitAddress: split.address,
      tokenAddress: token,
      amountDistributed,
      splitBalanceBefore: splitBalance,
      splitBalanceAfter,
      recipientDeltas,
      txHash,
    })
  }

  async #splitBalances(splitAddress: Address, tokenAddress: Address) {
    const balances = await this.#publicClient.readContract({
      address: splitAddress,
      abi: splitV2ABI,
      functionName: 'getSplitBalance',
      args: [tokenAddress],
    })
    return {
      splitBalance: balances[0],
      warehouseBalance: balances[1],
    }
  }

  async #tokenBalance(token: Address, holder: Address): Promise<bigint> {
    return this.#publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [holder],
    })
  }

  async #assertChain(): Promise<void> {
    const actual = await this.#publicClient.getChainId()
    if (actual !== this.#chainId) {
      throw new RevenueSplitProtocolError(
        `RPC chain ${actual} does not match configured chain ${this.#chainId}.`,
      )
    }
  }
}
