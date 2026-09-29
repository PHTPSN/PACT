import { createWalletClient, getAddress, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import type { Treasury, TreasurySigner } from './types.js'
import { connectTreasury } from './connectTreasury.js'

export async function deployTreasury({
  treasury,
  deployer,
}: {
  treasury: Treasury
  deployer: TreasurySigner
}) {
  const safe = await connectTreasury(treasury, deployer)
  if (await safe.isSafeDeployed()) {
    return { address: treasury.address, alreadyDeployed: true as const }
  }
  const deployment = await safe.createSafeDeploymentTransaction()
  const account = privateKeyToAccount(deployer.privateKey)
  if (getAddress(account.address) !== getAddress(deployer.address)) {
    throw new Error('Treasury deployer private key does not match its address.')
  }
  const wallet = createWalletClient({ account, transport: http(treasury.provider) })
  const transactionHash = await wallet.sendTransaction({
    account,
    chain: null,
    to: getAddress(deployment.to),
    value: BigInt(deployment.value),
    data: deployment.data as `0x${string}`,
  })
  return {
    address: treasury.address,
    alreadyDeployed: false as const,
    transactionHash,
  }
}
