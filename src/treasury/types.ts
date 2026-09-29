import type {
  Implementation,
  MetaMaskSmartAccount,
} from '@metamask/smart-accounts-kit'
import { toMetaMaskSmartAccount } from '@metamask/smart-accounts-kit'
import type {
  Account,
  Address,
  Chain,
  Hash,
  Hex,
  PublicClient,
  Transport,
} from 'viem'
import type {
  BundlerClient,
  UserOperation,
  UserOperationReceipt,
} from 'viem/account-abstraction'

export type TreasuryConfig = {
  owners: readonly Address[]
  threshold: number
}

export type TreasuryCall = {
  to: Address
  data?: Hex
  value?: bigint
}

export type MultisigAccount = MetaMaskSmartAccount<Implementation.MultiSig>

export type SmartAccountsPublicClient = Parameters<
  typeof toMetaMaskSmartAccount<Implementation.MultiSig>
>[0]['client']

export type Treasury = {
  config: Readonly<TreasuryConfig>
  deploySalt: Hex
  account: MultisigAccount
  address: Address
  publicClient: PublicClient<any, any, any>
}

export type TreasurySigner = Pick<
  Account,
  'address' | 'signMessage' | 'signTypedData'
>

export type SignerView = {
  owner: Address
  treasury: Treasury
  account: MultisigAccount
  address: Address
}

export type TreasuryOperation = {
  operationHash: Hash
  userOperation: UserOperation<'0.7'>
}

export type BoundPartialSignature = {
  signer: Address
  signature: Hex
  type: 'ECDSA'
  operationHash: Hash
}

export type TreasuryBundlerClient = BundlerClient<
  Transport,
  Chain | undefined,
  MultisigAccount | undefined
>

export type ExecutionResult = {
  treasuryAddress: Address
  threshold: number
  participatingOwners: Address[]
  userOperationHash?: Hash
  transactionHash?: Hash
  success: boolean
  error?: string
  receipt?: UserOperationReceipt
}
