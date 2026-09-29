import { describe, expect, it } from 'vitest'

import { validateTreasuryConfig } from '../../src/treasury/index.js'
import { oneOfOne } from '../fixtures/oneOfOne.js'
import { oneOfThree } from '../fixtures/oneOfThree.js'
import { threeOfFive } from '../fixtures/threeOfFive.js'
import { threeOfThree } from '../fixtures/threeOfThree.js'
import { twoOfFour } from '../fixtures/twoOfFour.js'
import { twoOfThree } from '../fixtures/twoOfThree.js'
import { twoOfTwo } from '../fixtures/twoOfTwo.js'
import { subsets } from '../fixtures/subsets.js'

const configurations = [
  ['1-of-1', oneOfOne],
  ['1-of-3', oneOfThree],
  ['2-of-2', twoOfTwo],
  ['2-of-3', twoOfThree],
  ['2-of-4', twoOfFour],
  ['3-of-3', threeOfThree],
  ['3-of-5', threeOfFive],
] as const

describe('generic M-of-N configuration', () => {
  it.each(configurations)('%s accepts exactly the distinct subsets of size M or larger', (_, fixture) => {
    const config = validateTreasuryConfig(fixture)
    for (const subset of subsets(config.owners)) {
      const distinctAuthorizedOwners = new Set(
        subset.filter(address =>
          config.owners.some(owner => owner.toLowerCase() === address.toLowerCase()),
        ).map(address => address.toLowerCase()),
      )
      expect(distinctAuthorizedOwners.size >= config.threshold).toBe(
        subset.length >= fixture.threshold,
      )
    }
  })
})
