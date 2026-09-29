import { describe, expect, it } from 'vitest'

import { validateTreasuryConfig } from '../../src/treasury/index.js'
import { agentWallet, alice, bob, carol, outsider } from '../fixtures/identities.js'

describe('canonical identities', () => {
  it('keeps the Agent Wallet and outsider outside the 2-of-3 Safe owner set', () => {
    const config = validateTreasuryConfig({
      owners: [alice.address, bob.address, carol.address],
      threshold: 2,
    })
    expect(config.owners).not.toContain(agentWallet.address)
    expect(config.owners).not.toContain(outsider.address)
    expect(new Set(config.owners.map(owner => owner.toLowerCase())).size).toBe(3)
  })
})
