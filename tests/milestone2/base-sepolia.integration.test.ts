import 'dotenv/config'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runMilestone2Proof } from '../../scripts/lib/milestone2Proof.js'
import { hasLiveEnvironment } from '../fixtures/liveEnvironment.js'

const hasCdpEnvironment = Boolean(
  process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET,
)

describe.skipIf(!hasLiveEnvironment || !hasCdpEnvironment)(
  'standard x402 on Base Sepolia',
  () => {
    it('proves unpaid, paid, onchain, replay, repeat, and insufficient-balance behavior', async () => {
      const evidence = await runMilestone2Proof()
      await writeFile(
        resolve(process.env.MILESTONE2_RESULT_PATH ?? 'milestone2-result.json'),
        `${JSON.stringify(evidence, null, 2)}\n`,
        'utf8',
      )
      expect(evidence.pass).toBe(true)
    }, 300_000)
  },
)
