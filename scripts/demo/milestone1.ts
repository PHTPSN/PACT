import 'dotenv/config'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { runMilestone1Proof } from '../lib/milestone1Proof.js'

const output = await runMilestone1Proof()
const outputPath = resolve(process.env.MILESTONE1_RESULT_PATH ?? 'milestone1-result.json')
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(output, null, 2))
process.exit(output.pass ? 0 : 1)
