import type { Address } from 'viem'

import type {
  RevenueDistributionResult,
  RevenueSplit,
  RevenueSplitConfig,
} from './types.js'

/**
 * Pact's application port for economic ownership. Splits SDK objects, contract
 * structs, wallet clients, and event logs must remain behind this boundary.
 */
export interface RevenueSplitAdapter {
  createImmutableSplit(config: RevenueSplitConfig): Promise<RevenueSplit>
  getSplit(splitAddress: Address): Promise<RevenueSplit>
  distributeToken(input: {
    splitAddress: Address
    tokenAddress: Address
  }): Promise<RevenueDistributionResult>
}
