import { getUserOperationHash } from 'viem/account-abstraction'

import type { MultisigAccount, TreasuryOperation } from './types.js'

export function operationHash(
  account: MultisigAccount,
  userOperation: TreasuryOperation['userOperation'],
) {
  const chainId = account.client.chain?.id
  if (chainId === undefined) {
    throw new Error('The public client must have a configured chain.')
  }

  return getUserOperationHash({
    chainId,
    entryPointAddress: account.entryPoint.address,
    entryPointVersion: account.entryPoint.version,
    userOperation,
  })
}
