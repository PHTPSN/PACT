import { createPublicClient, getAddress, http, type Address } from 'viem'

import { connectTreasury } from './connectTreasury.js'
import type {
  ExecutionResult,
  Treasury,
  TreasuryAction,
  TreasurySigner,
} from './types.js'

const EXECUTION_SUCCESS_TOPIC =
  '0x442e715f626346e8c54381002da614f62bee8d27386535b2521ec8540898556e'

function participatingOwners(action: TreasuryAction): Address[] {
  return [...action.signatures.keys()].map((address) => getAddress(address))
}

export async function executeTreasuryAction({
  treasury,
  action,
  executor,
}: {
  treasury: Treasury
  action: TreasuryAction
  executor: TreasurySigner
}): Promise<ExecutionResult> {
  const owners = participatingOwners(action)
  try {
    const safe = await connectTreasury(treasury, executor)
    const submitted = await safe.executeTransaction(action)
    const publicClient = createPublicClient({ transport: http(treasury.provider) })
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: submitted.hash as `0x${string}`,
    })
    const safeExecutionSucceeded = receipt.logs.some(
      log =>
        log.address.toLowerCase() === treasury.address.toLowerCase() &&
        log.topics[0] === EXECUTION_SUCCESS_TOPIC,
    )
    const success = receipt.status === 'success' && safeExecutionSucceeded
    return {
      treasuryAddress: treasury.address,
      threshold: treasury.config.threshold,
      participatingOwners: owners,
      transactionHash: receipt.transactionHash,
      success,
      ...(!success
        ? {
            error:
              receipt.status === 'reverted'
                ? 'Safe transaction reverted.'
                : 'Outer transaction succeeded without Safe ExecutionSuccess.',
          }
        : {}),
      receipt,
    }
  } catch (error) {
    return {
      treasuryAddress: treasury.address,
      threshold: treasury.config.threshold,
      participatingOwners: owners,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function simulateTreasuryAction({
  treasury,
  action,
  caller,
}: {
  treasury: Treasury
  action: TreasuryAction
  caller: Address
}): Promise<{ success: boolean; error?: string }> {
  try {
    const safe = await connectTreasury(treasury)
    const data = (await safe.getEncodedTransaction(action)) as `0x${string}`
    const client = createPublicClient({ transport: http(treasury.provider) })
    await client.call({ account: caller, to: treasury.address, data })
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
