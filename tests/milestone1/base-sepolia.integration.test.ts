import 'dotenv/config'
import { describe, expect, it } from 'vitest'

import {
  createTreasury,
  executeMultisigOperation,
} from '../../src/treasury/index.js'
import {
  hasLiveEnvironment,
  loadLiveEnvironment,
} from '../fixtures/liveEnvironment.js'

describe.skipIf(!hasLiveEnvironment)('Base Sepolia threshold enforcement', () => {
  it('rejects one owner and executes with two distinct owners', async () => {
    const { publicClient, bundlerClient, alice, bob, carol, outsider } =
      loadLiveEnvironment()
    expect(await publicClient.getChainId()).toBe(84532)

    const treasury = await createTreasury({
      client: publicClient,
      config: {
        owners: [alice.address, bob.address, carol.address],
        threshold: 2,
      },
      deploySalt: '0x4d696c6573746f6e6531',
    })
    const call = { to: outsider.address, value: 1n, data: '0x' as const }

    const beforeRejectedAttempt = await publicClient.getBalance({
      address: outsider.address,
    })
    const rejected = await executeMultisigOperation({
      treasury,
      calls: [call],
      signers: [alice],
      bundlerClient,
    })
    expect(rejected.success).toBe(false)
    expect(await publicClient.getBalance({ address: outsider.address })).toBe(
      beforeRejectedAttempt,
    )

    const accepted = await executeMultisigOperation({
      treasury,
      calls: [call],
      signers: [alice, bob],
      bundlerClient,
    })
    expect(accepted.success, accepted.error).toBe(true)
    expect(accepted.userOperationHash).toMatch(/^0x[0-9a-f]{64}$/i)
    expect(accepted.transactionHash).toMatch(/^0x[0-9a-f]{64}$/i)
    expect(await publicClient.getBalance({ address: outsider.address })).toBe(
      beforeRejectedAttempt + 1n,
    )
  }, 180_000)
})
