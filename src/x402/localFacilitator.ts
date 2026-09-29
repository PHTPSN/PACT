import {
  ExecutionMode,
  contracts,
  createExecution,
} from '@metamask/smart-accounts-kit'
import { decodeDelegations } from '@metamask/smart-accounts-kit/utils'
import type { FacilitatorClient } from '@x402/core/server'
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from '@x402/core/types'
import {
  encodeFunctionData,
  erc20Abi,
  getAddress,
  isAddress,
  isHex,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type Transport,
  type WalletClient,
} from 'viem'

import { BASE_SEPOLIA_NETWORK } from './constants.js'

type DelegationPayload = {
  delegationManager: Address
  permissionContext: `0x${string}`
  delegator: Address
}

function parsePayload(paymentPayload: PaymentPayload): DelegationPayload {
  const payload = paymentPayload.payload
  const delegationManager = payload.delegationManager
  const permissionContext = payload.permissionContext
  const delegator = payload.delegator
  if (
    typeof delegationManager !== 'string' ||
    !isAddress(delegationManager) ||
    typeof permissionContext !== 'string' ||
    !isHex(permissionContext) ||
    typeof delegator !== 'string' ||
    !isAddress(delegator)
  ) {
    throw new Error('Malformed ERC-7710 payment payload.')
  }
  return {
    delegationManager: getAddress(delegationManager),
    permissionContext,
    delegator: getAddress(delegator),
  }
}

function buildRedemption(
  paymentPayload: PaymentPayload,
  requirements: PaymentRequirements,
) {
  if (
    paymentPayload.x402Version !== 2 ||
    requirements.network !== BASE_SEPOLIA_NETWORK ||
    requirements.extra.assetTransferMethod !== 'erc7710' ||
    !isAddress(requirements.asset) ||
    !isAddress(requirements.payTo)
  ) {
    throw new Error('Unsupported ERC-7710 payment requirements.')
  }
  const payload = parsePayload(paymentPayload)
  const delegations = decodeDelegations(payload.permissionContext)
  const root = delegations.at(-1)
  if (!root || root.delegator.toLowerCase() !== payload.delegator.toLowerCase()) {
    throw new Error('Delegation chain does not match its declared root payer.')
  }
  const execution = createExecution({
    target: getAddress(requirements.asset),
    callData: encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [getAddress(requirements.payTo), BigInt(requirements.amount)],
    }),
  })
  return { payload, delegations, execution }
}

export class LocalErc7710Facilitator implements FacilitatorClient {
  readonly #publicClient: {
    waitForTransactionReceipt(args: { hash: Hash }): Promise<{ status: string }>
  }
  readonly #walletClient: WalletClient<Transport, Chain, Account>
  readonly address: Address

  constructor({
    publicClient,
    walletClient,
  }: {
    publicClient: {
      waitForTransactionReceipt(args: { hash: Hash }): Promise<{ status: string }>
    }
    walletClient: WalletClient<Transport, Chain, Account>
  }) {
    if (!walletClient.account) throw new Error('Facilitator wallet requires an account.')
    this.#publicClient = publicClient
    this.#walletClient = walletClient
    this.address = getAddress(walletClient.account.address)
  }

  async getSupported(): Promise<SupportedResponse> {
    return {
      kinds: [
        {
          x402Version: 2,
          scheme: 'exact',
          network: BASE_SEPOLIA_NETWORK,
          extra: {
            assetTransferMethods: ['erc7710'],
            facilitatorAddresses: [this.address],
          },
        },
      ],
      extensions: [],
      signers: { 'eip155:*': [this.address] },
    }
  }

  async verify(
    paymentPayload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    try {
      const { payload, delegations, execution } = buildRedemption(
        paymentPayload,
        requirements,
      )
      await contracts.DelegationManager.simulate.redeemDelegations({
        client: this.#walletClient,
        delegationManagerAddress: payload.delegationManager,
        delegations: [delegations],
        modes: [ExecutionMode.SingleDefault],
        executions: [[execution]],
      })
      return { isValid: true, payer: payload.delegator }
    } catch (error) {
      const decoded =
        contracts.DelegationManager.decode.redeemDelegationsError(error)
      return {
        isValid: false,
        invalidReason: decoded?.errorName ?? 'invalid_exact_evm_erc7710_delegation',
        invalidMessage:
          decoded?.message ?? (error instanceof Error ? error.message : String(error)),
      }
    }
  }

  async settle(
    paymentPayload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const { payload, delegations, execution } = buildRedemption(
      paymentPayload,
      requirements,
    )
    try {
      const transaction = await contracts.DelegationManager.execute.redeemDelegations({
        client: this.#walletClient,
        delegationManagerAddress: payload.delegationManager,
        delegations: [delegations],
        modes: [ExecutionMode.SingleDefault],
        executions: [[execution]],
      })
      const receipt = await this.#publicClient.waitForTransactionReceipt({
        hash: transaction,
      })
      if (receipt.status !== 'success') {
        throw new Error('Delegation redemption transaction reverted.')
      }
      return {
        success: true,
        payer: payload.delegator,
        transaction,
        network: BASE_SEPOLIA_NETWORK,
        amount: requirements.amount,
      }
    } catch (error) {
      return {
        success: false,
        payer: payload.delegator,
        transaction: '0x',
        network: BASE_SEPOLIA_NETWORK,
        errorReason: 'invalid_exact_evm_erc7710_settlement',
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  }
}
