import { randomUUID } from 'node:crypto'
import { getAddress, isAddress, zeroAddress, type Address } from 'viem'

import {
  BudgetApprovalError,
  BudgetExecutionError,
  BudgetProposalNotFoundError,
} from './errors.js'
import type {
  BudgetAuditEvent,
  BudgetAuditSink,
  BudgetIssuer,
  BudgetProposal,
  CreateBudgetProposalInput,
  PactRuntimeConfig,
} from './types.js'
import type {
  BudgetTransferSnapshot,
  BudgetTreasuryAdapter,
} from './treasuryAdapter.js'
import { validateProposalInput, validateRuntimeConfig } from './validation.js'

type ProposalRecord = {
  proposal: BudgetProposal
  adapterReference: string
}

type BudgetIssuerDependencies = {
  config: PactRuntimeConfig
  treasury: BudgetTreasuryAdapter
  audit?: BudgetAuditSink
  now?: () => string
  idFactory?: () => string
}

function cloneProposal(proposal: BudgetProposal): BudgetProposal {
  return Object.freeze({
    ...proposal,
    approvals: Object.freeze([...proposal.approvals]),
    ...(proposal.balanceDeltas
      ? { balanceDeltas: Object.freeze({ ...proposal.balanceDeltas }) }
      : {}),
  })
}

function normalizedApprovals(approvals: readonly Address[]): readonly Address[] {
  const unique = new Map<string, Address>()
  for (const approval of approvals) {
    const normalized = getAddress(approval)
    unique.set(normalized.toLowerCase(), normalized)
  }
  return Object.freeze([...unique.values()])
}

export class InMemoryBudgetIssuer implements BudgetIssuer {
  readonly #config: Readonly<PactRuntimeConfig>
  readonly #treasury: BudgetTreasuryAdapter
  readonly #audit: BudgetAuditSink | undefined
  readonly #now: () => string
  readonly #idFactory: () => string
  readonly #records = new Map<string, ProposalRecord>()
  readonly #executions = new Map<string, Promise<BudgetProposal>>()

  constructor({
    config,
    treasury,
    audit,
    now = () => new Date().toISOString(),
    idFactory = randomUUID,
  }: BudgetIssuerDependencies) {
    this.#config = validateRuntimeConfig(config)
    this.#treasury = treasury
    this.#audit = audit
    this.#now = now
    this.#idFactory = idFactory
  }

  async createProposal(input: CreateBudgetProposalInput): Promise<BudgetProposal> {
    const validated = validateProposalInput(this.#config, input)
    const transfer = await this.#treasury.prepareTransfer({
      treasuryAddress: validated.treasuryAddress,
      recipientAddress: validated.recipientAddress,
      tokenAddress: validated.tokenAddress,
      amount: validated.amount,
    })
    if (!Number.isSafeInteger(transfer.threshold) || transfer.threshold < 1) {
      throw new BudgetApprovalError('Safe returned an invalid approval threshold.')
    }
    const id = this.#idFactory()
    const approvals = normalizedApprovals(transfer.approvals)
    const proposal = cloneProposal({
      id,
      ...validated,
      threshold: transfer.threshold,
      approvals,
      safeTxHash: transfer.safeTxHash,
      status:
        approvals.length >= transfer.threshold ? 'ready' : 'awaiting_approvals',
      createdAt: this.#now(),
    })
    this.#records.set(id, { proposal, adapterReference: transfer.reference })
    this.#emit('BUDGET_PROPOSED', proposal)
    if (proposal.status === 'ready') this.#emit('BUDGET_READY', proposal)
    return cloneProposal(proposal)
  }

  async getProposal(id: string): Promise<BudgetProposal> {
    const record = this.#record(id)
    if (
      record.proposal.status === 'executed' ||
      record.proposal.status === 'executing' ||
      record.proposal.status === 'failed'
    ) {
      return cloneProposal(record.proposal)
    }
    const snapshot = await this.#treasury.getTransfer(record.adapterReference)
    this.#synchronize(record, snapshot)
    return cloneProposal(record.proposal)
  }

  async approveProposal({
    proposalId,
    signer,
  }: {
    proposalId: string
    signer: Address
  }): Promise<BudgetProposal> {
    const record = this.#record(proposalId)
    if (record.proposal.status === 'executed') {
      throw new BudgetApprovalError('An executed proposal cannot be approved.')
    }
    if (record.proposal.status === 'executing') {
      throw new BudgetApprovalError('A proposal being executed cannot be approved.')
    }
    if (record.proposal.status === 'failed') {
      throw new BudgetApprovalError('A failed proposal cannot be approved.')
    }
    if (!isAddress(signer, { strict: false })) {
      throw new BudgetApprovalError('Signer is not a valid address.')
    }
    const normalizedSigner = getAddress(signer)
    if (normalizedSigner.toLowerCase() === zeroAddress) {
      throw new BudgetApprovalError('Signer must not be the zero address.')
    }
    const previous = new Set(
      record.proposal.approvals.map(approval => approval.toLowerCase()),
    )
    const wasReady = record.proposal.status === 'ready'
    const snapshot = await this.#treasury.approveTransfer({
      reference: record.adapterReference,
      signer: normalizedSigner,
    })
    this.#synchronize(record, snapshot)
    if (!previous.has(normalizedSigner.toLowerCase())) {
      this.#emit('BUDGET_APPROVED', record.proposal, normalizedSigner)
    }
    if (!wasReady && record.proposal.status === 'ready') {
      this.#emit('BUDGET_READY', record.proposal, normalizedSigner)
    }
    return cloneProposal(record.proposal)
  }

  async executeProposal(proposalId: string): Promise<BudgetProposal> {
    const record = this.#record(proposalId)
    if (record.proposal.status === 'executed') {
      return cloneProposal(record.proposal)
    }
    const active = this.#executions.get(proposalId)
    if (active) return active
    const execution = this.#performExecution(record)
    this.#executions.set(proposalId, execution)
    try {
      return await execution
    } finally {
      this.#executions.delete(proposalId)
    }
  }

  async #performExecution(record: ProposalRecord): Promise<BudgetProposal> {
    if (record.proposal.status === 'failed') {
      throw new BudgetExecutionError(
        'A failed proposal cannot be retried automatically; reconcile its on-chain state first.',
      )
    }
    const snapshot = await this.#treasury.getTransfer(record.adapterReference)
    this.#synchronize(record, snapshot)
    if (snapshot.executed && snapshot.executionTxHash) {
      record.proposal = cloneProposal({
        ...record.proposal,
        status: 'executed',
        executionTxHash: snapshot.executionTxHash,
        executedAt: this.#now(),
      })
      return cloneProposal(record.proposal)
    }
    if (record.proposal.approvals.length < record.proposal.threshold) {
      throw new BudgetExecutionError(
        `Proposal has ${record.proposal.approvals.length} valid approval(s); ${record.proposal.threshold} required.`,
      )
    }
    record.proposal = cloneProposal({ ...record.proposal, status: 'executing' })
    try {
      const result = await this.#treasury.executeTransfer(record.adapterReference)
      record.proposal = cloneProposal({
        ...record.proposal,
        status: 'executed',
        executionTxHash: result.transactionHash,
        balanceDeltas: result.balanceDeltas,
        executedAt: this.#now(),
      })
      this.#emit('BUDGET_EXECUTED', record.proposal)
      return cloneProposal(record.proposal)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      record.proposal = cloneProposal({
        ...record.proposal,
        status: 'failed',
        failureReason: reason,
      })
      this.#emit('BUDGET_FAILED', record.proposal, undefined, reason)
      throw new BudgetExecutionError(`Budget execution failed: ${reason}`)
    }
  }

  #record(id: string): ProposalRecord {
    const record = this.#records.get(id)
    if (!record) throw new BudgetProposalNotFoundError(`Unknown proposal: ${id}`)
    return record
  }

  #synchronize(record: ProposalRecord, snapshot: BudgetTransferSnapshot): void {
    if (!Number.isSafeInteger(snapshot.threshold) || snapshot.threshold < 1) {
      throw new BudgetApprovalError('Safe returned an invalid approval threshold.')
    }
    const approvals = normalizedApprovals(snapshot.approvals)
    record.proposal = cloneProposal({
      ...record.proposal,
      threshold: snapshot.threshold,
      approvals,
      ...(snapshot.executionTxHash
        ? { executionTxHash: snapshot.executionTxHash }
        : {}),
      status: snapshot.executed
        ? 'executed'
        : approvals.length >= snapshot.threshold
          ? 'ready'
          : 'awaiting_approvals',
    })
  }

  #emit(
    type: BudgetAuditEvent['type'],
    proposal: BudgetProposal,
    actor?: Address,
    error?: string,
  ): void {
    this.#audit?.(
      Object.freeze({
        type,
        at: this.#now(),
        proposalId: proposal.id,
        safeAddress: proposal.treasuryAddress,
        safeTxHash: proposal.safeTxHash,
        ...(actor ? { actor } : {}),
        threshold: proposal.threshold,
        approvalCount: proposal.approvals.length,
        token: proposal.tokenAddress,
        amount: proposal.amount,
        recipient: proposal.recipientAddress,
        ...(proposal.executionTxHash
          ? { executionTxHash: proposal.executionTxHash }
          : {}),
        ...(error ? { error } : {}),
      }),
    )
  }
}
