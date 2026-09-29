import {
  Implementation,
  toMetaMaskSmartAccount,
} from '@metamask/smart-accounts-kit'
import type { Hex } from 'viem'

import type {
  SmartAccountsPublicClient,
  Treasury,
  TreasuryConfig,
} from './types.js'
import { validateTreasuryConfig } from './validateTreasuryConfig.js'

export async function createTreasury({
  client,
  config,
  deploySalt = '0x',
}: {
  client: Treasury['publicClient']
  config: TreasuryConfig
  deploySalt?: Hex
}): Promise<Treasury> {
  const validated = validateTreasuryConfig(config)
  const account = await toMetaMaskSmartAccount({
    client: client as SmartAccountsPublicClient,
    implementation: Implementation.MultiSig,
    deployParams: [[...validated.owners], BigInt(validated.threshold)],
    deploySalt,
  })

  return Object.freeze({
    config: validated,
    deploySalt,
    account,
    address: account.address,
    publicClient: client,
  })
}
