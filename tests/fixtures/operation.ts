import type { Hex } from 'viem'

import type { Treasury, TreasuryOperation } from '../../src/treasury/index.js'
import { operationHash } from '../../src/treasury/index.js'

export function makeOperation(
  treasury: Treasury,
  overrides: { callData?: Hex; nonce?: bigint } = {},
): TreasuryOperation {
  const userOperation = {
    sender: treasury.address,
    nonce: overrides.nonce ?? 0n,
    callData: overrides.callData ?? '0x1234',
    callGasLimit: 100_000n,
    verificationGasLimit: 300_000n,
    preVerificationGas: 50_000n,
    maxFeePerGas: 1_000_000_000n,
    maxPriorityFeePerGas: 1_000_000n,
    signature: '0x' as const,
  }

  return {
    userOperation,
    operationHash: operationHash(treasury.account, userOperation),
  }
}
