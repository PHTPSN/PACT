import {
  CaveatType,
  Implementation,
  ScopeType,
  createDelegation,
  toMetaMaskSmartAccount,
} from '@metamask/smart-accounts-kit'
import { encodeDelegations } from '@metamask/smart-accounts-kit/utils'
import { getAddress, type Address, type Hex } from 'viem'

import type {
  SmartAccountsPublicClient,
  Treasury,
  TreasurySigner,
} from '../treasury/index.js'
import type { TreasuryAgentDelegation } from './types.js'
import { validatePeriodicErc20Policy } from './validatePolicy.js'

function selectAuthorizedSigners({
  treasury,
  signers,
}: {
  treasury: Treasury
  signers: readonly TreasurySigner[]
}): TreasurySigner[] {
  const owners = new Set(treasury.config.owners.map((owner) => owner.toLowerCase()))
  const selected = new Map<string, TreasurySigner>()

  for (const signer of signers) {
    const normalized = getAddress(signer.address)
    if (!owners.has(normalized.toLowerCase())) {
      throw new Error(`Signer ${normalized} is not a Treasury owner.`)
    }
    selected.set(normalized.toLowerCase(), signer)
  }

  if (selected.size < treasury.config.threshold) {
    throw new Error(
      `Root delegation requires ${treasury.config.threshold} distinct Treasury owners; received ${selected.size}.`,
    )
  }

  return treasury.config.owners
    .map((owner) => selected.get(owner.toLowerCase()))
    .filter((signer): signer is TreasurySigner => signer !== undefined)
    .slice(0, treasury.config.threshold)
}

export async function createTreasuryAgentDelegation({
  treasury,
  agentSession,
  policy,
  ownerSigners,
  salt = '0x',
}: {
  treasury: Treasury
  agentSession: Address
  policy: Parameters<typeof validatePeriodicErc20Policy>[0]
  ownerSigners: readonly TreasurySigner[]
  salt?: Hex
}): Promise<TreasuryAgentDelegation> {
  const validatedPolicy = validatePeriodicErc20Policy(policy)
  const selectedSigners = selectAuthorizedSigners({ treasury, signers: ownerSigners })
  const chainId = await treasury.publicClient.getChainId()

  const signingAccount = await toMetaMaskSmartAccount({
    client: treasury.publicClient as SmartAccountsPublicClient,
    implementation: Implementation.MultiSig,
    deployParams: [[...treasury.config.owners], BigInt(treasury.config.threshold)],
    deploySalt: treasury.deploySalt,
    signer: selectedSigners.map((account) => ({ account })),
    environment: treasury.account.environment,
  })

  if (signingAccount.address.toLowerCase() !== treasury.address.toLowerCase()) {
    throw new Error('Delegation signer configuration derived a different Treasury address.')
  }

  const unsigned = createDelegation({
    environment: treasury.account.environment,
    from: treasury.address,
    to: getAddress(agentSession),
    salt,
    scope: {
      type: ScopeType.Erc20PeriodTransfer,
      tokenAddress: validatedPolicy.tokenAddress,
      periodAmount: validatedPolicy.periodAmount,
      periodDuration: validatedPolicy.periodDurationSeconds,
      startDate: validatedPolicy.startsAt,
    },
    caveats: [
      {
        type: CaveatType.Timestamp,
        afterThreshold: validatedPolicy.startsAt,
        beforeThreshold: validatedPolicy.expiresAt,
      },
    ],
  })
  const signature = await signingAccount.signDelegation({
    delegation: unsigned,
    chainId,
  })
  const delegation = { ...unsigned, signature }
  const permissionContext = [delegation]

  return Object.freeze({
    treasury,
    agentSession: getAddress(agentSession),
    policy: validatedPolicy,
    delegation,
    permissionContext,
    encodedPermissionContext: encodeDelegations(permissionContext),
    environment: treasury.account.environment,
  })
}
