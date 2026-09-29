import { genericOwners } from './identities.js'

export const threeOfFive = {
  accounts: [...genericOwners],
  owners: genericOwners.map(({ address }) => address),
  threshold: 3,
} as const
