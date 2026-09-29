import { getErc20PeriodTransferEnforcerAvailableAmount } from '@metamask/smart-accounts-kit/actions'

import type { TreasuryAgentDelegation } from './types.js'

export async function readDelegatedBudget(
  authority: TreasuryAgentDelegation,
) {
  return getErc20PeriodTransferEnforcerAvailableAmount(
    authority.treasury.publicClient,
    authority.environment,
    { delegation: authority.delegation },
  )
}
