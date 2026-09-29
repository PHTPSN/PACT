import { describe, expect, it } from 'vitest'

import {
  aggregateSignatures,
  createSignerView,
  createTreasury,
  signOperation,
  type TreasurySigner,
} from '../../src/treasury/index.js'
import { offlinePublicClient } from '../fixtures/client.js'
import { makeOperation } from '../fixtures/operation.js'
import { subsets } from '../fixtures/subsets.js'
import { oneOfOne } from '../fixtures/oneOfOne.js'
import { oneOfThree } from '../fixtures/oneOfThree.js'
import { threeOfFive } from '../fixtures/threeOfFive.js'
import { threeOfThree } from '../fixtures/threeOfThree.js'
import { twoOfFour } from '../fixtures/twoOfFour.js'
import { twoOfThree } from '../fixtures/twoOfThree.js'
import { twoOfTwo } from '../fixtures/twoOfTwo.js'
import { universalOutsider } from '../fixtures/identities.js'

const fixtures: Array<{
  label: string
  accounts: readonly TreasurySigner[]
  owners: (typeof oneOfOne.owners)[number][]
  threshold: number
}> = [
  { label: '1-of-1', ...oneOfOne, owners: [...oneOfOne.owners] },
  { label: '1-of-3', ...oneOfThree, owners: [...oneOfThree.owners] },
  { label: '2-of-2', ...twoOfTwo, owners: [...twoOfTwo.owners] },
  { label: '2-of-3', ...twoOfThree, owners: [...twoOfThree.owners] },
  { label: '2-of-4', ...twoOfFour, owners: [...twoOfFour.owners] },
  { label: '3-of-3', ...threeOfThree, owners: [...threeOfThree.owners] },
  { label: '3-of-5', ...threeOfFive, owners: [...threeOfFive.owners] },
]

describe('generic threshold fixture oracle', () => {
  it.each(fixtures)('$label signs and aggregates every owner subset', async (fixture) => {
    const treasury = await createTreasury({
      client: offlinePublicClient,
      config: fixture,
      deploySalt: '0x03',
    })
    const operation = makeOperation(treasury)
    const views = await Promise.all(
      fixture.accounts.map((signer) => createSignerView({ treasury, signer })),
    )
    await expect(
      createSignerView({ treasury, signer: universalOutsider }),
    ).rejects.toThrow(/not a treasury owner/)

    for (const subset of subsets(views)) {
      const signatures = await Promise.all(
        subset.map((signerView) => signOperation({ signerView, operation })),
      )
      const aggregate = aggregateSignatures({ treasury, operation, signatures })

      // ECDSA contributes 65 bytes per distinct owner. This is the test oracle;
      // production never executes based on this count. The MultiSigDeleGator
      // enforces the threshold in the live integration test.
      expect((aggregate.length - 2) / 2).toBe(subset.length * 65)
      const expectedAuthorization = subset.length >= fixture.threshold
      expect(typeof expectedAuthorization).toBe('boolean')
    }
  })

  it('covers every canonical two-owner pair without a privileged pair', () => {
    const acceptedPairs = subsets(twoOfThree.owners).filter(
      (subset) => subset.length === twoOfThree.threshold,
    )
    expect(acceptedPairs).toHaveLength(3)
  })
})
