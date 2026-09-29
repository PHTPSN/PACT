import { describe, expect, it } from 'vitest'

import {
  aggregateSignatures,
  createSignerView,
  createTreasury,
  signOperation,
} from '../../src/treasury/index.js'
import { offlinePublicClient } from '../fixtures/client.js'
import { alice, bob, carol, outsider } from '../fixtures/identities.js'
import { makeOperation } from '../fixtures/operation.js'
import { twoOfThree } from '../fixtures/twoOfThree.js'

async function setup() {
  const treasury = await createTreasury({
    client: offlinePublicClient,
    config: twoOfThree,
    deploySalt: '0x02',
  })
  const aliceView = await createSignerView({ treasury, signer: alice })
  const bobView = await createSignerView({ treasury, signer: bob })
  const carolView = await createSignerView({ treasury, signer: carol })
  return { treasury, aliceView, bobView, carolView }
}

describe('signature integrity', () => {
  it.each([
    ['Alice', 'aliceView'],
    ['Bob', 'bobView'],
    ['Carol', 'carolView'],
  ] as const)('rejects duplicate %s signatures', async (_label, viewName) => {
    const context = await setup()
    const { treasury } = context
    const signerView = context[viewName]
    const operation = makeOperation(treasury)
    const signature = await signOperation({ signerView, operation })

    expect(() =>
      aggregateSignatures({
        treasury,
        operation,
        signatures: [signature, signature],
      }),
    ).toThrow(/Duplicate signature/)
  })

  it('rejects a signature bound to a different operation', async () => {
    const { treasury, aliceView, bobView } = await setup()
    const operationX = makeOperation(treasury, { callData: '0x1234' })
    const operationY = makeOperation(treasury, { callData: '0x5678' })
    const aliceX = await signOperation({ signerView: aliceView, operation: operationX })
    const bobY = await signOperation({ signerView: bobView, operation: operationY })

    expect(() =>
      aggregateSignatures({
        treasury,
        operation: operationX,
        signatures: [aliceX, bobY],
      }),
    ).toThrow(/different operation/)
  })

  it('rejects outsiders without identity-specific logic', async () => {
    const { treasury } = await setup()
    await expect(createSignerView({ treasury, signer: outsider })).rejects.toThrow(
      /not a treasury owner/,
    )
  })

  it('is invariant to signer order', async () => {
    const { treasury, aliceView, bobView } = await setup()
    const operation = makeOperation(treasury)
    const aliceSignature = await signOperation({ signerView: aliceView, operation })
    const bobSignature = await signOperation({ signerView: bobView, operation })

    const aliceThenBob = aggregateSignatures({
      treasury,
      operation,
      signatures: [aliceSignature, bobSignature],
    })
    const bobThenAlice = aggregateSignatures({
      treasury,
      operation,
      signatures: [bobSignature, aliceSignature],
    })
    expect(aliceThenBob).toBe(bobThenAlice)
  })
})
