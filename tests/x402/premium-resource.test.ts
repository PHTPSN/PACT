import { describe, expect, it } from 'vitest'

import { PREMIUM_MARKET_BRIEF } from '../../src/x402/premiumServer.js'

describe('premium market brief', () => {
  it('provides deterministic decision-grade data rather than a placeholder', () => {
    expect(PREMIUM_MARKET_BRIEF.reportId).toBe('pact-market-brief-2026-q3')
    expect(PREMIUM_MARKET_BRIEF.markets).toHaveLength(3)
    const ranked = [...PREMIUM_MARKET_BRIEF.markets].sort(
      (left, right) =>
        right.developerAdoptionScore + right.paidAgentReadinessScore -
        (left.developerAdoptionScore + left.paidAgentReadinessScore),
    )
    expect(ranked[0]?.market).toBe(
      PREMIUM_MARKET_BRIEF.recommendation.primaryMarket,
    )
    expect(JSON.stringify(PREMIUM_MARKET_BRIEF)).not.toContain('"hello"')
  })
})
