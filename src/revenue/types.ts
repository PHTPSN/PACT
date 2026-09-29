import type { Address, Hash } from 'viem'

export type RevenueShare = {
  recipient: Address
  allocationBps: number
}

export type RevenueSplitConfig = {
  recipients: readonly RevenueShare[]
  immutable: true
}

export type RevenueSplit = {
  id: string
  chainId: number
  address: Address
  recipients: readonly RevenueShare[]
  immutable: true
  creationTxHash?: Hash
  createdAt: string
}

export type RevenueDistributionResult = {
  splitAddress: Address
  tokenAddress: Address
  amountDistributed: bigint
  splitBalanceBefore: bigint
  splitBalanceAfter: bigint
  recipientDeltas: readonly {
    recipient: Address
    amount: bigint
  }[]
  txHash: Hash
}

export type RevenueAuditEvent =
  | {
      type: 'REVENUE_SPLIT_CREATED'
      at: string
      splitAddress: Address
      recipients: readonly RevenueShare[]
      txHash?: Hash
    }
  | {
      type: 'REVENUE_RECEIVED'
      at: string
      splitAddress: Address
      tokenAddress: Address
      amount: bigint
    }
  | {
      type: 'REVENUE_DISTRIBUTED'
      at: string
      splitAddress: Address
      tokenAddress: Address
      amount: bigint
      recipientDeltas: RevenueDistributionResult['recipientDeltas']
      txHash: Hash
    }

export type RevenueAuditSink = (event: Readonly<RevenueAuditEvent>) => void
