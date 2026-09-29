import { alice, bob, carol } from './identities.js'

export const twoOfThree = {
  accounts: [alice, bob, carol],
  owners: [alice.address, bob.address, carol.address],
  threshold: 2,
} as const
