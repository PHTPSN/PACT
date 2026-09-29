import { aggregateSignature as aggregateSdkSignature } from '@metamask/smart-accounts-kit'
import type { Hex } from 'viem'

import { TreasurySignatureError } from './errors.js'
import type {
  BoundPartialSignature,
  Treasury,
  TreasuryOperation,
} from './types.js'

export function aggregateSignatures({
  treasury,
  operation,
  signatures,
}: {
  treasury: Treasury
  operation: TreasuryOperation
  signatures: readonly BoundPartialSignature[]
}): Hex {
  const ownerSet = new Set(
    treasury.config.owners.map((owner) => owner.toLowerCase()),
  )
  const seen = new Set<string>()

  for (const partial of signatures) {
    const signer = partial.signer.toLowerCase()
    if (!ownerSet.has(signer)) {
      throw new TreasurySignatureError(
        `Signature from non-owner ${partial.signer} is not authorized.`,
      )
    }
    if (seen.has(signer)) {
      throw new TreasurySignatureError(
        `Duplicate signature from owner ${partial.signer}.`,
      )
    }
    if (partial.operationHash !== operation.operationHash) {
      throw new TreasurySignatureError(
        `Signature from ${partial.signer} belongs to a different operation.`,
      )
    }
    seen.add(signer)
  }

  return aggregateSdkSignature({
    signatures: signatures.map(({ signer, signature, type }) => ({
      signer,
      signature,
      type,
    })),
  })
}
