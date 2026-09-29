import { contracts } from '@metamask/smart-accounts-kit'

import type { TreasuryCall } from '../treasury/index.js'
import type { TreasuryAgentDelegation } from './types.js'

export function buildDelegationRevocationCall(
  authority: TreasuryAgentDelegation,
): TreasuryCall {
  return {
    to: authority.environment.DelegationManager,
    data: contracts.DelegationManager.encode.disableDelegation({
      delegation: authority.delegation,
    }),
  }
}
