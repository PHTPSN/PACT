import type {
  Delegation,
  PermissionContext,
  SmartAccountsEnvironment,
} from '@metamask/smart-accounts-kit'
import type { Address, Hex } from 'viem'

import type { Treasury } from '../treasury/index.js'

export type PeriodicErc20Policy = {
  tokenAddress: Address
  periodAmount: bigint
  periodDurationSeconds: number
  startsAt: number
  expiresAt: number
}

export type TreasuryAgentDelegation = {
  treasury: Treasury
  agentSession: Address
  policy: Readonly<PeriodicErc20Policy>
  delegation: Delegation
  permissionContext: PermissionContext
  encodedPermissionContext: Hex
  environment: SmartAccountsEnvironment
}

export type StoredTreasuryAgentDelegation = {
  version: 1
  chainId: number
  treasury: Address
  agentSession: Address
  delegationManager: Hex
  permissionContext: Hex
  policy: {
    tokenAddress: Address
    periodAmount: string
    periodDurationSeconds: number
    startsAt: number
    expiresAt: number
  }
}
