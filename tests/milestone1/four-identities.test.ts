import { describe, expect, it } from 'vitest'

import { createSignerView, createTreasury } from '../../src/treasury/index.js'
import { offlinePublicClient } from '../fixtures/client.js'
import { agentSession, alice, bob, carol, outsider } from '../fixtures/identities.js'
import { subsets } from '../fixtures/subsets.js'
import { twoOfThree } from '../fixtures/twoOfThree.js'

describe('canonical four-identity fixture', () => {
  it('keeps the fourth identity and an unrelated outsider outside ownership', async () => {
    const treasury = await createTreasury({
      client: offlinePublicClient,
      config: twoOfThree,
    })

    expect(treasury.config.owners).toEqual([alice.address, bob.address, carol.address])
    expect(treasury.config.owners).not.toContain(agentSession.address)
    await expect(
      createSignerView({ treasury, signer: agentSession }),
    ).rejects.toThrow(/not a treasury owner/)
    await expect(createSignerView({ treasury, signer: outsider })).rejects.toThrow(
      /not a treasury owner/,
    )

    for (const owner of [alice, bob, carol]) {
      await expect(
        Promise.all([
          createSignerView({ treasury, signer: owner }),
          createSignerView({ treasury, signer: agentSession }),
        ]),
      ).rejects.toThrow(/not a treasury owner/)
      await expect(
        Promise.all([
          createSignerView({ treasury, signer: owner }),
          createSignerView({ treasury, signer: outsider }),
        ]),
      ).rejects.toThrow(/not a treasury owner/)
    }
  })

  it('enumerates the expected 2-of-3 owner-subset matrix', () => {
    const matrix = subsets(twoOfThree.owners).map((subset) => ({
      size: subset.length,
      authorized: subset.length >= twoOfThree.threshold,
    }))
    expect(matrix.filter(({ authorized }) => authorized)).toHaveLength(4)
    expect(matrix.filter(({ authorized }) => !authorized)).toHaveLength(4)
  })
})
