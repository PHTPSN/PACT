import 'dotenv/config'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  aggregateSignatures,
  createSignerView,
  createTreasury,
  executeMultisigOperation,
  signOperation,
} from '../../src/treasury/index.js'
import { loadLiveEnvironment } from '../../tests/fixtures/liveEnvironment.js'
import { makeOperation } from '../../tests/fixtures/operation.js'

const identities = loadLiveEnvironment()
const { publicClient, bundlerClient, alice, bob, carol, agentSession, outsider } =
  identities

if ((await publicClient.getChainId()) !== 84532) {
  throw new Error('BASE_SEPOLIA_RPC_URL is not connected to Base Sepolia (84532).')
}

const treasury = await createTreasury({
  client: publicClient,
  config: {
    owners: [alice.address, bob.address, carol.address],
    threshold: 2,
  },
  deploySalt: '0x4d696c6573746f6e6531',
})

const [aliceView, bobView, carolView] = await Promise.all([
  createSignerView({ treasury, signer: alice }),
  createSignerView({ treasury, signer: bob }),
  createSignerView({ treasury, signer: carol }),
])
const sameTreasuryAddress = [aliceView, bobView, carolView].every(
  ({ address }) => address === treasury.address,
)
const agentNotOwner = !treasury.config.owners.some(
  (owner) => owner.toLowerCase() === agentSession.address.toLowerCase(),
)

console.log('Alice:', alice.address)
console.log('Bob:', bob.address)
console.log('Carol:', carol.address)
console.log('AgentSession:', agentSession.address)
console.log('Treasury:', treasury.address)

const transactions: Array<{
  signers: string[]
  userOperationHash?: string
  transactionHash?: string
  success: boolean
  error?: string
}> = []

async function execute(signers: typeof identities.alice[]) {
  const result = await executeMultisigOperation({
    treasury,
    calls: [{ to: outsider.address, value: 1n, data: '0x' }],
    signers,
    bundlerClient,
  })
  transactions.push({
    signers: signers.map(({ address }) => address),
    ...(result.userOperationHash
      ? { userOperationHash: result.userOperationHash }
      : {}),
    ...(result.transactionHash ? { transactionHash: result.transactionHash } : {}),
    success: result.success,
    ...(result.error ? { error: result.error } : {}),
  })
  return result
}

const outsiderBalanceBefore = await publicClient.getBalance({
  address: outsider.address,
})
const oneOwner = await execute([alice])
const oneOwnerRejected =
  !oneOwner.success &&
  (await publicClient.getBalance({ address: outsider.address })) ===
    outsiderBalanceBefore

const aliceBob = await execute([alice, bob])
const aliceCarol = await execute([alice, carol])
const bobCarol = await execute([bob, carol])
const threeOwners = await execute([alice, bob, carol])
const agentPlusOne = await execute([alice, agentSession])

const operationX = makeOperation(treasury, { callData: '0x1234' })
const operationY = makeOperation(treasury, { callData: '0x5678' })
const aliceX = await signOperation({ signerView: aliceView, operation: operationX })
const bobY = await signOperation({ signerView: bobView, operation: operationY })

let duplicateSignerRejected = false
try {
  aggregateSignatures({
    treasury,
    operation: operationX,
    signatures: [aliceX, aliceX],
  })
} catch {
  duplicateSignerRejected = true
}

let mixedOperationSignaturesRejected = false
try {
  aggregateSignatures({
    treasury,
    operation: operationX,
    signatures: [aliceX, bobY],
  })
} catch {
  mixedOperationSignaturesRejected = true
}

const results = {
  sameTreasuryAddress,
  oneOwnerRejected,
  aliceBobAccepted: aliceBob.success,
  aliceCarolAccepted: aliceCarol.success,
  bobCarolAccepted: bobCarol.success,
  threeOwnersAccepted: threeOwners.success,
  agentNotOwner,
  agentPlusOneRejected: !agentPlusOne.success,
  duplicateSignerRejected,
  mixedOperationSignaturesRejected,
}

const output = {
  milestone: 1,
  network: 'base-sepolia',
  fixture: { ownerCount: 3, threshold: 2 },
  treasury: treasury.address,
  demoIdentities: {
    alice: alice.address,
    bob: bob.address,
    carol: carol.address,
    agentSession: agentSession.address,
  },
  results,
  transactions,
  pass: Object.values(results).every(Boolean),
}

const outputPath = resolve(process.env.MILESTONE1_RESULT_PATH ?? 'milestone1-result.json')
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(output, null, 2))
console.log(output.pass ? 'PASS' : 'FAIL')
process.exit(output.pass ? 0 : 1)
