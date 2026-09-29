import { describe, expect, it } from 'vitest'

import { createSignerView, createTreasury } from '../../src/treasury/index.js'
import { offlinePublicClient } from '../fixtures/client.js'
import { twoOfThree } from '../fixtures/twoOfThree.js'

describe('signer-specific treasury views', () => {
  it('derive one identical smart-account address', async () => {
    const treasury = await createTreasury({
      client: offlinePublicClient,
      config: twoOfThree,
      deploySalt: '0x01',
    })
    const views = await Promise.all(
      twoOfThree.accounts.map((signer) => createSignerView({ treasury, signer })),
    )

    expect(new Set(views.map(({ address }) => address)).size).toBe(1)
    expect(views.every(({ address }) => address === treasury.address)).toBe(true)
  })
})
