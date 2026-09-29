import { describe, expect, it } from 'vitest'
import { zeroAddress } from 'viem'

import { validateTreasuryConfig } from '../../src/treasury/index.js'
import { alice, bob } from '../fixtures/identities.js'

describe('validateTreasuryConfig', () => {
  it('accepts arbitrary valid M-of-N configurations', () => {
    expect(
      validateTreasuryConfig({
        owners: [alice.address, bob.address],
        threshold: 1,
      }),
    ).toEqual({ owners: [alice.address, bob.address], threshold: 1 })
  })

  it.each([
    { label: 'empty owners', owners: [], threshold: 1 },
    { label: 'zero threshold', owners: [alice.address], threshold: 0 },
    { label: 'threshold above N', owners: [alice.address], threshold: 2 },
    { label: 'fractional threshold', owners: [alice.address], threshold: 0.5 },
    {
      label: 'duplicate owners',
      owners: [alice.address, alice.address],
      threshold: 1,
    },
    { label: 'zero owner', owners: [zeroAddress], threshold: 1 },
  ])('rejects $label', ({ owners, threshold }) => {
    expect(() => validateTreasuryConfig({ owners, threshold })).toThrow()
  })
})
