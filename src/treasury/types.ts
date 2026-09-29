import type {
  MetaTransactionData,
  SafeTransaction,
  SafeVersion,
} from '@safe-global/types-kit'
import type { Address, Hash, Hex, TransactionReceipt } from 'viem'

import type { SafeProtocolKit } from './safeProtocolKit.js'

export type TreasuryConfig = {
  owners: readonly Address[]
  threshold: number
}

export type TreasuryCall = {
  to: Address
  data?: Hex
  value?: bigint
}

export type TreasurySigner = {
  address: Address
  privateKey: Hex
}

export type Treasury = {
  config: Readonly<TreasuryConfig>
  provider: string
  safeVersion: SafeVersion
  saltNonce: string
  predictedSafe: {
    safeAccountConfig: {
      owners: string[]
      threshold: number
    }
    safeDeploymentConfig: {
      safeVersion: SafeVersion
      saltNonce: string
    }
  }
  address: Address
  protocolKit: SafeProtocolKit
}

export type TreasuryAction = SafeTransaction

export type TreasuryProposal = {
  treasuryAddress: Address
  nonce: number
  transactions: readonly MetaTransactionData[]
  action: TreasuryAction
}

export type TreasuryInspection = {
  address: Address
  deployed: boolean
  version: SafeVersion
  owners: Address[]
  threshold: number
  modules: Address[]
  guard: Address
  moduleGuard: Address
  moduleGuardSupported: boolean
  fallbackHandler: Address
}

export type ExecutionResult = {
  treasuryAddress: Address
  threshold: number
  participatingOwners: Address[]
  transactionHash?: Hash
  success: boolean
  error?: string
  receipt?: TransactionReceipt
}
