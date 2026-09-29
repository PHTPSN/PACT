import { genericOwners } from './identities.js'

export const twoOfFour = {
  accounts: genericOwners.slice(0, 4),
  owners: genericOwners.slice(0, 4).map(({ address }) => address),
  threshold: 2,
} as const
