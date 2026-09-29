import { genericOwners } from './identities.js'

export const twoOfTwo = {
  accounts: genericOwners.slice(0, 2),
  owners: genericOwners.slice(0, 2).map(({ address }) => address),
  threshold: 2,
} as const
