import { genericOwners } from './identities.js'

export const threeOfThree = {
  accounts: genericOwners.slice(0, 3),
  owners: genericOwners.slice(0, 3).map(({ address }) => address),
  threshold: 3,
} as const
