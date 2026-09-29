import * as ProtocolKitModule from '@safe-global/protocol-kit'
import type {
  MetaTransactionData,
  SafeTransaction,
  SafeVersion,
} from '@safe-global/types-kit'

export type SafeInitConfig = {
  provider: string
  signer?: string
  safeAddress?: string
  predictedSafe?: {
    safeAccountConfig: { owners: string[]; threshold: number }
    safeDeploymentConfig: { safeVersion: SafeVersion; saltNonce: string }
  }
}

export type SafeProtocolKit = {
  isSafeDeployed(): Promise<boolean>
  getAddress(): Promise<string>
  getContractVersion(): SafeVersion
  getOwners(): Promise<string[]>
  getThreshold(): Promise<number>
  getModules(): Promise<string[]>
  getGuard(): Promise<string>
  getModuleGuard(): Promise<string>
  getFallbackHandler(): Promise<string>
  createTransaction(input: {
    transactions: MetaTransactionData[]
    options?: { nonce: number }
  }): Promise<SafeTransaction>
  signTransaction(action: SafeTransaction): Promise<SafeTransaction>
  executeTransaction(action: SafeTransaction): Promise<{ hash: string }>
  getEncodedTransaction(action: SafeTransaction): Promise<string>
  createSafeDeploymentTransaction(): Promise<{
    to: string
    value: string
    data: string
  }>
}

const SafeFactory = ProtocolKitModule.default as unknown as {
  init(config: SafeInitConfig): Promise<SafeProtocolKit>
}

export function initSafe(config: SafeInitConfig): Promise<SafeProtocolKit> {
  return SafeFactory.init(config)
}
