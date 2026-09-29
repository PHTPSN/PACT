import type { Address, Hash } from 'viem'

import type { BudgetBalanceDeltas } from './types.js'

export type BudgetTransferInput = {
  treasuryAddress: Address
  recipientAddress: Address
  tokenAddress: Address
  amount: bigint
}

export type BudgetTransferSnapshot = {
  reference: string
  safeTxHash: Hash
  treasuryAddress: Address
  threshold: number
  approvals: readonly Address[]
  executed: boolean
  executionTxHash?: Hash
}

export type BudgetTransferExecution = {
  transactionHash: Hash
  balanceDeltas: BudgetBalanceDeltas
}

/**
 * Application port implemented by the Safe integration. Safe SDK transaction
 * objects deliberately do not cross this boundary.
 */
export interface BudgetTreasuryAdapter {
  prepareTransfer(input: BudgetTransferInput): Promise<BudgetTransferSnapshot>
  getTransfer(reference: string): Promise<BudgetTransferSnapshot>
  approveTransfer(input: {
    reference: string
    signer: Address
  }): Promise<BudgetTransferSnapshot>
  executeTransfer(reference: string): Promise<BudgetTransferExecution>
}
