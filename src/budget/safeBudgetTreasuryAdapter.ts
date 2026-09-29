import {
  createPublicClient,
  erc20Abi,
  getAddress,
  http,
  type Address,
  type Hash,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import {
  approveTreasuryAction,
  connectTreasury,
  executeTreasuryAction,
  proposeTreasuryAction,
  type Treasury,
  type TreasuryAction,
  type TreasurySigner,
} from '../treasury/index.js'
import { BudgetApprovalError, BudgetExecutionError } from './errors.js'
import { encodeErc20Transfer } from './erc20.js'
import type {
  BudgetTransferExecution,
  BudgetTransferInput,
  BudgetTransferSnapshot,
  BudgetTreasuryAdapter,
} from './treasuryAdapter.js'

type SafeTransfer = {
  action: TreasuryAction
  safeTxHash: Hash
  tokenAddress: Address
  recipientAddress: Address
  amount: bigint
  execution?: BudgetTransferExecution
}

export class SafeBudgetTreasuryAdapter implements BudgetTreasuryAdapter {
  readonly #treasury: Treasury
  readonly #executor: TreasurySigner
  readonly #signers: ReadonlyMap<string, TreasurySigner>
  readonly #transfers = new Map<string, SafeTransfer>()

  constructor({
    treasury,
    signers,
    executor,
  }: {
    treasury: Treasury
    signers: readonly TreasurySigner[]
    executor: TreasurySigner
  }) {
    this.#treasury = treasury
    this.#executor = this.#validatedSigner(executor)
    const configured = new Map<string, TreasurySigner>()
    for (const signer of signers) {
      const validated = this.#validatedSigner(signer)
      configured.set(validated.address.toLowerCase(), validated)
    }
    this.#signers = configured
  }

  async prepareTransfer(
    input: BudgetTransferInput,
  ): Promise<BudgetTransferSnapshot> {
    if (getAddress(input.treasuryAddress) !== this.#treasury.address) {
      throw new BudgetExecutionError(
        'The requested treasury does not match the configured Safe.',
      )
    }
    if (input.amount <= 0n) {
      throw new BudgetExecutionError('Transfer amount must be greater than zero.')
    }
    const safe = await connectTreasury(this.#treasury)
    if (!(await safe.isSafeDeployed())) {
      throw new BudgetExecutionError(
        'Operating budgets require an already deployed Safe.',
      )
    }
    const proposal = await proposeTreasuryAction({
      treasury: this.#treasury,
      calls: [
        {
          to: getAddress(input.tokenAddress),
          value: 0n,
          data: encodeErc20Transfer(
            getAddress(input.recipientAddress),
            input.amount,
          ),
        },
      ],
    })
    const safeTxHash = (await safe.getTransactionHash(proposal.action)) as Hash
    if (this.#transfers.has(safeTxHash)) {
      throw new BudgetExecutionError(
        `Safe transaction ${safeTxHash} is already tracked.`,
      )
    }
    this.#transfers.set(safeTxHash, {
      action: proposal.action,
      safeTxHash,
      tokenAddress: getAddress(input.tokenAddress),
      recipientAddress: getAddress(input.recipientAddress),
      amount: input.amount,
    })
    return this.getTransfer(safeTxHash)
  }

  async getTransfer(reference: string): Promise<BudgetTransferSnapshot> {
    const transfer = this.#transfer(reference)
    const safe = await connectTreasury(this.#treasury)
    const [owners, threshold] = await Promise.all([
      safe.getOwners(),
      safe.getThreshold(),
    ])
    const ownerSet = new Set(owners.map(owner => owner.toLowerCase()))
    const approvals = [...transfer.action.signatures.keys()]
      .map(address => getAddress(address))
      .filter(address => ownerSet.has(address.toLowerCase()))
    return {
      reference,
      safeTxHash: transfer.safeTxHash,
      treasuryAddress: this.#treasury.address,
      threshold,
      approvals,
      executed: Boolean(transfer.execution),
      ...(transfer.execution
        ? { executionTxHash: transfer.execution.transactionHash }
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
    const transfer = this.#transfer(reference)
    if (transfer.execution) {
      throw new BudgetApprovalError('The Safe transaction is already executed.')
    }
    const normalizedSigner = getAddress(signer)
    const safe = await connectTreasury(this.#treasury)
    const owners = await safe.getOwners()
    if (!owners.some(owner => getAddress(owner) === normalizedSigner)) {
      throw new BudgetApprovalError('Only a current Safe owner may approve.')
    }
    const configured = this.#signers.get(normalizedSigner.toLowerCase())
    if (!configured) {
      throw new BudgetApprovalError(
        `No signing credentials are configured for ${normalizedSigner}.`,
      )
    }
    if (
      [...transfer.action.signatures.keys()].some(
        address => getAddress(address) === normalizedSigner,
      )
    ) {
      return this.getTransfer(reference)
    }
    transfer.action = await approveTreasuryAction({
      treasury: this.#treasury,
      action: transfer.action,
      signer: configured,
    })
    return this.getTransfer(reference)
  }

  async executeTransfer(reference: string): Promise<BudgetTransferExecution> {
    const transfer = this.#transfer(reference)
    if (transfer.execution) return transfer.execution
    const snapshot = await this.getTransfer(reference)
    if (snapshot.approvals.length < snapshot.threshold) {
      throw new BudgetExecutionError(
        `Safe transaction has ${snapshot.approvals.length} valid confirmation(s); ${snapshot.threshold} required.`,
      )
    }
    const publicClient = createPublicClient({
      cacheTime: 0,
      transport: http(this.#treasury.provider),
    })
    const [treasuryBefore, recipientBefore] = await Promise.all([
      publicClient.readContract({
        address: transfer.tokenAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [this.#treasury.address],
      }),
      publicClient.readContract({
        address: transfer.tokenAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [transfer.recipientAddress],
      }),
    ])
    const result = await executeTreasuryAction({
      treasury: this.#treasury,
      action: transfer.action,
      executor: this.#executor,
    })
    if (!result.success || !result.transactionHash) {
      throw new BudgetExecutionError(
        result.error ?? 'Safe transaction execution did not succeed.',
      )
    }
    let treasuryAfter = treasuryBefore
    let recipientAfter = recipientBefore
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const balances = await Promise.all([
        publicClient.readContract({
          address: transfer.tokenAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [this.#treasury.address],
        }),
        publicClient.readContract({
          address: transfer.tokenAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [transfer.recipientAddress],
        }),
      ])
      treasuryAfter = balances[0]
      recipientAfter = balances[1]
      if (
        treasuryBefore - treasuryAfter === transfer.amount &&
        recipientAfter - recipientBefore === transfer.amount
      ) {
        break
      }
      await new Promise(resolve => setTimeout(resolve, 1_000))
    }
    transfer.execution = Object.freeze({
      transactionHash: result.transactionHash,
      balanceDeltas: Object.freeze({
        treasuryBefore,
        treasuryAfter,
        recipientBefore,
        recipientAfter,
      }),
    })
    return transfer.execution
  }

  #transfer(reference: string): SafeTransfer {
    const transfer = this.#transfers.get(reference)
    if (!transfer) {
      throw new BudgetExecutionError(`Unknown Safe transfer: ${reference}`)
    }
    return transfer
  }

  #validatedSigner(signer: TreasurySigner): TreasurySigner {
    const normalized = getAddress(signer.address)
    const derived = getAddress(privateKeyToAccount(signer.privateKey).address)
    if (normalized !== derived) {
      throw new BudgetApprovalError(
        `Signer private key does not match ${normalized}.`,
      )
    }
    return { address: normalized, privateKey: signer.privateKey }
  }
}
