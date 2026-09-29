import type { Address, Hash } from 'viem'

export type BudgetProposalStatus =
  | 'draft'
  | 'awaiting_approvals'
  | 'ready'
  | 'executing'
  | 'executed'
  | 'failed'

export type TokenConfig = {
  address: Address
  symbol: string
  decimals: number
}

export type PactRuntimeConfig = {
  agentWalletAddress: Address
  tokens: readonly TokenConfig[]
}

export type BudgetBalanceDeltas = {
  treasuryBefore: bigint
  treasuryAfter: bigint
  recipientBefore: bigint
  recipientAfter: bigint
}

export type BudgetProposal = {
  id: string
  treasuryAddress: Address
  recipientAddress: Address
  tokenAddress: Address
  tokenDecimals: number
  amount: bigint
  memo?: string
  threshold: number
  approvals: readonly Address[]
  safeTxHash: Hash
  executionTxHash?: Hash
  balanceDeltas?: BudgetBalanceDeltas
  status: BudgetProposalStatus
  createdAt: string
  executedAt?: string
  failureReason?: string
}

export type CreateBudgetProposalInput = {
  treasuryAddress: Address
  recipientAddress: Address
  tokenAddress: Address
  tokenDecimals: number
  amount: bigint
  memo?: string
}

export type ApproveBudgetProposalInput = {
  proposalId: string
  signer: Address
}

export interface BudgetIssuer {
  createProposal(input: CreateBudgetProposalInput): Promise<BudgetProposal>
  getProposal(id: string): Promise<BudgetProposal>
  approveProposal(input: ApproveBudgetProposalInput): Promise<BudgetProposal>
  executeProposal(proposalId: string): Promise<BudgetProposal>
}

export type BudgetAuditEventType =
  | 'BUDGET_PROPOSED'
  | 'BUDGET_APPROVED'
  | 'BUDGET_READY'
  | 'BUDGET_EXECUTED'
  | 'BUDGET_FAILED'

export type BudgetAuditEvent = {
  type: BudgetAuditEventType
  at: string
  proposalId: string
  safeAddress: Address
  safeTxHash: Hash
  actor?: Address
  threshold: number
  approvalCount: number
  token: Address
  amount: bigint
  recipient: Address
  executionTxHash?: Hash
  error?: string
}

export type BudgetAuditSink = (event: Readonly<BudgetAuditEvent>) => void
