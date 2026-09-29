import type { StoredTreasuryAgentDelegation, TreasuryAgentDelegation } from './types.js'

export async function toStoredTreasuryAgentDelegation(
  authority: TreasuryAgentDelegation,
): Promise<StoredTreasuryAgentDelegation> {
  return {
    version: 1,
    chainId: await authority.treasury.publicClient.getChainId(),
    treasury: authority.treasury.address,
    agentSession: authority.agentSession,
    delegationManager: authority.environment.DelegationManager,
    permissionContext: authority.encodedPermissionContext,
    policy: {
      tokenAddress: authority.policy.tokenAddress,
      periodAmount: authority.policy.periodAmount.toString(),
      periodDurationSeconds: authority.policy.periodDurationSeconds,
      startsAt: authority.policy.startsAt,
      expiresAt: authority.policy.expiresAt,
    },
  }
}
