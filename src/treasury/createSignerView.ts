import {
  Implementation,
  toMetaMaskSmartAccount,
} from '@metamask/smart-accounts-kit'
import { getAddress } from 'viem'

import { TreasurySignatureError } from './errors.js'
import type {
  SignerView,
  SmartAccountsPublicClient,
  Treasury,
  TreasurySigner,
} from './types.js'

export async function createSignerView({
  treasury,
  signer,
}: {
  treasury: Treasury
  signer: TreasurySigner
}): Promise<SignerView> {
  const owner = getAddress(signer.address)
  const isOwner = treasury.config.owners.some(
    (candidate) => candidate.toLowerCase() === owner.toLowerCase(),
  )
  if (!isOwner) {
    throw new TreasurySignatureError(`${owner} is not a treasury owner.`)
  }

  const account = await toMetaMaskSmartAccount({
    client: treasury.publicClient as SmartAccountsPublicClient,
    implementation: Implementation.MultiSig,
    deployParams: [
      [...treasury.config.owners],
      BigInt(treasury.config.threshold),
    ],
    deploySalt: treasury.deploySalt,
    signer: [{ account: signer }],
  })

  if (account.address.toLowerCase() !== treasury.address.toLowerCase()) {
    throw new Error('Signer view resolved to a different treasury address.')
  }

  return Object.freeze({ owner, treasury, account, address: account.address })
}
