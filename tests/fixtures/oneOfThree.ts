import { genericOwners } from './identities.js'

export const oneOfThree = {
  accounts: genericOwners.slice(0, 3),
  owners: genericOwners.slice(0, 3).map(({ address }) => address),
  threshold: 1,
} as const
