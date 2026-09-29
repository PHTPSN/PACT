import { genericOwners } from './identities.js'

export const oneOfOne = {
  accounts: genericOwners.slice(0, 1),
  owners: genericOwners.slice(0, 1).map(({ address }) => address),
  threshold: 1,
} as const
