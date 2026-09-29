import 'dotenv/config'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { runMilestone1Proof } from '../../scripts/lib/milestone1Proof.js'
import { hasLiveEnvironment } from '../fixtures/liveEnvironment.js'

describe.skipIf(!hasLiveEnvironment)('Safe on Base Sepolia', () => {
  it('enforces the complete canonical 2-of-3 authorization matrix onchain', async () => {
    const evidence = await runMilestone1Proof()
    await writeFile(
      resolve(process.env.MILESTONE1_RESULT_PATH ?? 'milestone1-result.json'),
      `${JSON.stringify(evidence, null, 2)}\n`,
      'utf8',
    )
    expect(evidence.pass).toBe(true)
  }, 300_000)
})
