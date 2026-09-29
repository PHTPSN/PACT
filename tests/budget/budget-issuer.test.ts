import { describe, expect, it } from 'vitest'
import {
  decodeFunctionData,
  erc20Abi,
  getAddress,
  zeroAddress,
  type Address,
  type Hash,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import {
  BudgetApprovalError,
  BudgetExecutionError,
  BudgetProposalNotFoundError,
  BudgetValidationError,
  InMemoryBudgetIssuer,
  encodeErc20Transfer,
  type BudgetAuditEvent,
  type BudgetTransferExecution,
  type BudgetTransferInput,
  type BudgetTransferSnapshot,
  type BudgetTreasuryAdapter,
} from '../../src/budget/index.js'

const account = (value: number) =>
  privateKeyToAccount(
    `0x${value.toString(16).padStart(64, '0')}` as `0x${string}`,
  )

const treasury = account(101).address
const agentWallet = account(102).address
const token = account(103).address
const otherToken = account(104).address
const outsider = account(105).address

function owners(count: number): Address[] {
  return Array.from({ length: count }, (_, index) => account(200 + index).address)
}

class FakeBudgetTreasuryAdapter implements BudgetTreasuryAdapter {
  readonly owners: readonly Address[]
  readonly threshold: number
  readonly startingTreasuryBalance: bigint
  readonly startingRecipientBalance: bigint
  prepared?: BudgetTransferInput
  executionCount = 0

  #approvals: Address[] = []
  #execution?: BudgetTransferExecution
  #reference = ''
  #safeTxHash = '' as Hash

  constructor({
    owners: ownerAddresses,
    threshold,
    startingTreasuryBalance = 10_000n,
    startingRecipientBalance = 250n,
  }: {
    owners: readonly Address[]
    threshold: number
    startingTreasuryBalance?: bigint
    startingRecipientBalance?: bigint
  }) {
    this.owners = ownerAddresses.map(owner => getAddress(owner))
    this.threshold = threshold
    this.startingTreasuryBalance = startingTreasuryBalance
    this.startingRecipientBalance = startingRecipientBalance
  }

  async prepareTransfer(input: BudgetTransferInput): Promise<BudgetTransferSnapshot> {
    this.prepared = input
    this.#reference = `transfer-${input.amount}`
    this.#safeTxHash = `0x${input.amount.toString(16).padStart(64, '0')}`
    return this.getTransfer(this.#reference)
  }

  async getTransfer(reference: string): Promise<BudgetTransferSnapshot> {
    this.#assertReference(reference)
    return {
      reference,
      safeTxHash: this.#safeTxHash,
      treasuryAddress: treasury,
      threshold: this.threshold,
      approvals: [...this.#approvals],
      executed: Boolean(this.#execution),
      ...(this.#execution
        ? { executionTxHash: this.#execution.transactionHash }
        : {}),
    }
  }

  async approveTransfer({
    reference,
    signer,
  }: {
    reference: string
    signer: Address
  }): Promise<BudgetTransferSnapshot> {
    this.#assertReference(reference)
    const normalized = getAddress(signer)
    if (!this.owners.includes(normalized)) {
      throw new BudgetApprovalError('Only a Safe owner may approve.')
    }
    if (!this.#approvals.includes(normalized)) this.#approvals.push(normalized)
    return this.getTransfer(reference)
  }

  async executeTransfer(reference: string): Promise<BudgetTransferExecution> {
    this.#assertReference(reference)
    if (this.#execution) return this.#execution
    if (this.#approvals.length < this.threshold) {
      throw new BudgetExecutionError('Safe threshold was not reached.')
    }
    const amount = this.prepared?.amount
    if (amount === undefined) throw new Error('No prepared transfer.')
    this.executionCount += 1
    this.#execution = {
      transactionHash: `0x${(10_000 + this.executionCount)
        .toString(16)
        .padStart(64, '0')}`,
      balanceDeltas: {
        treasuryBefore: this.startingTreasuryBalance,
        treasuryAfter: this.startingTreasuryBalance - amount,
        recipientBefore: this.startingRecipientBalance,
        recipientAfter: this.startingRecipientBalance + amount,
      },
    }
    return this.#execution
  }

  #assertReference(reference: string): void {
    if (!this.#reference || reference !== this.#reference) {
      throw new Error(`Unknown transfer: ${reference}`)
    }
  }
}

function issuerFor(
  adapter: FakeBudgetTreasuryAdapter,
  audit?: (event: Readonly<BudgetAuditEvent>) => void,
) {
  return new InMemoryBudgetIssuer({
    config: {
      agentWalletAddress: agentWallet,
      tokens: [{ address: token, symbol: 'TKN', decimals: 6 }],
    },
    treasury: adapter,
    ...(audit ? { audit } : {}),
    now: () => '2026-01-02T03:04:05.000Z',
    idFactory: () => 'proposal-fixture',
  })
}

async function createProposal(
  issuer: InMemoryBudgetIssuer,
  overrides: Partial<Parameters<InMemoryBudgetIssuer['createProposal']>[0]> = {},
) {
  return issuer.createProposal({
    treasuryAddress: treasury,
    recipientAddress: agentWallet,
    tokenAddress: token,
    tokenDecimals: 6,
    amount: 375n,
    memo: 'fixture-driven operating budget',
    ...overrides,
  })
}

function combinations<T>(values: readonly T[], size: number): T[][] {
  if (size === 0) return [[]]
  return values.flatMap((value, index) =>
    combinations(values.slice(index + 1), size - 1).map(rest => [value, ...rest]),
  )
}

describe('collective budget issuance', () => {
  it('constructs a normalized proposal from configurable values', async () => {
    const adapter = new FakeBudgetTreasuryAdapter({ owners: owners(4), threshold: 3 })
    const issuer = issuerFor(adapter)

    const proposal = await createProposal(issuer, {
      treasuryAddress: treasury.toLowerCase() as Address,
      recipientAddress: agentWallet.toLowerCase() as Address,
      tokenAddress: token.toLowerCase() as Address,
      amount: 927_451n,
    })

    expect(proposal).toMatchObject({
      id: 'proposal-fixture',
      treasuryAddress: treasury,
      recipientAddress: agentWallet,
      tokenAddress: token,
      tokenDecimals: 6,
      amount: 927_451n,
      threshold: 3,
      approvals: [],
      status: 'awaiting_approvals',
    })
    expect(adapter.prepared).toEqual({
      treasuryAddress: treasury,
      recipientAddress: agentWallet,
      tokenAddress: token,
      amount: 927_451n,
    })
  })

  it.each([
    { memberCount: 1, threshold: 1 },
    { memberCount: 3, threshold: 2 },
    { memberCount: 4, threshold: 3 },
    { memberCount: 5, threshold: 3 },
  ])(
    '$threshold-of-$memberCount remains pending below M and executes at M',
    async ({ memberCount, threshold }) => {
      const members = owners(memberCount)
      const adapter = new FakeBudgetTreasuryAdapter({ owners: members, threshold })
      const issuer = issuerFor(adapter)
      let proposal = await createProposal(issuer)

      await expect(issuer.executeProposal(proposal.id)).rejects.toThrow(
        BudgetExecutionError,
      )
      for (const signer of members.slice(0, threshold - 1)) {
        proposal = await issuer.approveProposal({
          proposalId: proposal.id,
          signer,
        })
        expect(proposal.status).toBe('awaiting_approvals')
      }
      proposal = await issuer.approveProposal({
        proposalId: proposal.id,
        signer: members[threshold - 1]!,
      })
      expect(proposal.status).toBe('ready')
      await expect(issuer.executeProposal(proposal.id)).resolves.toMatchObject({
        status: 'executed',
      })
    },
  )

  it('accepts every distinct threshold-sized signer subset without a preferred pair', async () => {
    const members = owners(4)
    for (const signerSet of combinations(members, 2)) {
      const adapter = new FakeBudgetTreasuryAdapter({ owners: members, threshold: 2 })
      const issuer = issuerFor(adapter)
      let proposal = await createProposal(issuer)
      for (const signer of signerSet) {
        proposal = await issuer.approveProposal({
          proposalId: proposal.id,
          signer,
        })
      }
      expect(proposal.approvals).toEqual(signerSet)
      expect((await issuer.executeProposal(proposal.id)).status).toBe('executed')
    }
  })

  it('rejects outsiders and does not count duplicate owner approvals twice', async () => {
    const members = owners(3)
    const adapter = new FakeBudgetTreasuryAdapter({ owners: members, threshold: 2 })
    const issuer = issuerFor(adapter)
    const proposal = await createProposal(issuer)

    await expect(
      issuer.approveProposal({ proposalId: proposal.id, signer: outsider }),
    ).rejects.toThrow(BudgetApprovalError)
    const once = await issuer.approveProposal({
      proposalId: proposal.id,
      signer: members[0]!,
    })
    const twice = await issuer.approveProposal({
      proposalId: proposal.id,
      signer: members[0]!,
    })
    expect(once.approvals).toHaveLength(1)
    expect(twice.approvals).toEqual(once.approvals)
    expect(twice.status).toBe('awaiting_approvals')
  })

  it.each([
    ['malformed signer', 'not-an-address' as Address],
    ['zero signer', zeroAddress],
  ])('rejects a %s', async (_, signer) => {
    const adapter = new FakeBudgetTreasuryAdapter({ owners: owners(2), threshold: 2 })
    const issuer = issuerFor(adapter)
    const proposal = await createProposal(issuer)
    await expect(
      issuer.approveProposal({ proposalId: proposal.id, signer }),
    ).rejects.toThrow(BudgetApprovalError)
  })

  it('encodes the configured ERC-20 transfer target, recipient, and integer amount', () => {
    const amount = 9_876_543_210n
    const data = encodeErc20Transfer(agentWallet, amount)
    const decoded = decodeFunctionData({ abi: erc20Abi, data })
    expect(decoded.functionName).toBe('transfer')
    expect(decoded.args).toEqual([agentWallet, amount])
  })

  it('executes only once and reports exact balance deltas', async () => {
    const members = owners(2)
    const adapter = new FakeBudgetTreasuryAdapter({
      owners: members,
      threshold: 1,
      startingTreasuryBalance: 1_500n,
      startingRecipientBalance: 25n,
    })
    const issuer = issuerFor(adapter)
    let proposal = await createProposal(issuer, { amount: 400n })
    proposal = await issuer.approveProposal({
      proposalId: proposal.id,
      signer: members[1]!,
    })

    const first = await issuer.executeProposal(proposal.id)
    const second = await issuer.executeProposal(proposal.id)

    expect(first).toEqual(second)
    expect(adapter.executionCount).toBe(1)
    expect(first.balanceDeltas).toEqual({
      treasuryBefore: 1_500n,
      treasuryAfter: 1_100n,
      recipientBefore: 25n,
      recipientAfter: 425n,
    })
  })

  it('emits normalized lifecycle events without signer secrets', async () => {
    const events: BudgetAuditEvent[] = []
    const members = owners(1)
    const adapter = new FakeBudgetTreasuryAdapter({ owners: members, threshold: 1 })
    const issuer = issuerFor(adapter, event => events.push(event))
    let proposal = await createProposal(issuer)
    proposal = await issuer.approveProposal({
      proposalId: proposal.id,
      signer: members[0]!,
    })
    await issuer.executeProposal(proposal.id)

    expect(events.map(event => event.type)).toEqual([
      'BUDGET_PROPOSED',
      'BUDGET_APPROVED',
      'BUDGET_READY',
      'BUDGET_EXECUTED',
    ])
    expect(events.flatMap(event => Object.keys(event))).not.toContain('privateKey')
  })

  it.each([
    ['zero amount', { amount: 0n }],
    ['negative amount', { amount: -1n }],
    ['malformed treasury', { treasuryAddress: 'not-an-address' as Address }],
    ['zero treasury', { treasuryAddress: zeroAddress }],
    ['zero recipient', { recipientAddress: zeroAddress }],
    ['wrong recipient', { recipientAddress: outsider }],
    ['zero token', { tokenAddress: zeroAddress }],
    ['unsupported token', { tokenAddress: otherToken }],
    ['wrong decimals', { tokenDecimals: 18 }],
  ])('rejects %s', async (_, overrides) => {
    const adapter = new FakeBudgetTreasuryAdapter({ owners: owners(3), threshold: 2 })
    const issuer = issuerFor(adapter)
    await expect(createProposal(issuer, overrides)).rejects.toThrow(
      BudgetValidationError,
    )
  })

  it('rejects unknown proposals', async () => {
    const adapter = new FakeBudgetTreasuryAdapter({ owners: owners(1), threshold: 1 })
    const issuer = issuerFor(adapter)
    await expect(issuer.getProposal('missing')).rejects.toThrow(
      BudgetProposalNotFoundError,
    )
  })

  it.each([0, 1.5])(
    'rejects an impossible threshold %s reported by an adapter',
    async threshold => {
      const adapter = new FakeBudgetTreasuryAdapter({
        owners: owners(1),
        threshold,
      })
      const issuer = issuerFor(adapter)
      await expect(createProposal(issuer)).rejects.toThrow(BudgetApprovalError)
    },
  )
})
