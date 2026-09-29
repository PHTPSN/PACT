import { getCompatibilityFallbackHandlerDeployment } from '@safe-global/safe-deployments'
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  zeroAddress,
  type Address,
  type Hash,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

import {
  approveTreasuryAction,
  createTreasury,
  deployTreasury,
  executeTreasuryAction,
  inspectTreasury,
  proposeTreasuryAction,
  simulateTreasuryAction,
  type Treasury,
  type TreasurySigner,
} from '../../src/treasury/index.js'
import { loadLiveEnvironment } from '../../tests/fixtures/liveEnvironment.js'

type NegativeEvidence = {
  label: string
  signatures: number
  safeRejected: boolean
  error?: string
}

async function signedAction(
  treasury: Treasury,
  signers: readonly TreasurySigner[],
  recipient: `0x${string}`,
) {
  const proposal = await proposeTreasuryAction({
    treasury,
    calls: [{ to: recipient, value: 1n }],
  })
  let action = proposal.action
  for (const signer of signers) {
    action = await approveTreasuryAction({ treasury, action, signer })
  }
  return action
}

async function waitForBalance(
  client: { getBalance(args: { address: Address }): Promise<bigint> },
  address: Address,
  expected: bigint,
): Promise<bigint> {
  let observed = await client.getBalance({ address })
  for (let attempt = 0; attempt < 15 && observed !== expected; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1_000))
    observed = await client.getBalance({ address })
  }
  return observed
}

export async function runMilestone1Proof() {
  const env = loadLiveEnvironment()
  if ((await env.publicClient.getChainId()) !== baseSepolia.id) {
    throw new Error('BASE_SEPOLIA_RPC_URL is not connected to Base Sepolia (84532).')
  }
  const owners = [env.alice, env.bob, env.carol] as const
  const treasury = await createTreasury({
    provider: env.rpcUrl,
    config: { owners: owners.map(owner => owner.address), threshold: 2 },
  })
  const uncachedPublicClient = createPublicClient({
    cacheTime: 0,
    chain: baseSepolia,
    transport: http(env.rpcUrl),
  })

  // The outsider is only a gas-paying relay. Safe authorization remains entirely
  // in the owner signatures checked by the Safe contract.
  const deployment = await deployTreasury({ treasury, deployer: env.outsider })
  if (deployment.transactionHash) {
    const receipt = await env.publicClient.waitForTransactionReceipt({
      hash: deployment.transactionHash,
    })
    if (receipt.status !== 'success') throw new Error('Safe deployment reverted.')
  }

  let fundingTransactionHash: Hash | undefined
  const safeBalance = await env.publicClient.getBalance({ address: treasury.address })
  let fundingVerified = safeBalance >= 4n
  if (safeBalance < 4n) {
    const account = privateKeyToAccount(env.outsider.privateKey)
    const wallet = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(env.rpcUrl),
    })
    fundingTransactionHash = await wallet.sendTransaction({
      account,
      chain: baseSepolia,
      to: treasury.address,
      value: 4n - safeBalance,
    })
    const receipt = await env.publicClient.waitForTransactionReceipt({
      hash: fundingTransactionHash,
    })
    if (receipt.status !== 'success') throw new Error('Safe test funding reverted.')
    const fundingTransaction = await env.publicClient.getTransaction({
      hash: fundingTransactionHash,
    })
    fundingVerified =
      fundingTransaction.to?.toLowerCase() === treasury.address.toLowerCase() &&
      fundingTransaction.value === 4n - safeBalance
  }

  const inspection = await inspectTreasury(treasury)
  const officialFallback = getCompatibilityFallbackHandlerDeployment({
    version: '1.4.1',
    network: String(baseSepolia.id),
  })
  if (!officialFallback) throw new Error('Official Safe fallback deployment not found.')

  const negative: NegativeEvidence[] = []
  const empty = await signedAction(treasury, [], env.outsider.address)
  const emptySimulation = await simulateTreasuryAction({
    treasury,
    action: empty,
    caller: env.outsider.address,
  })
  negative.push({
    label: 'empty',
    signatures: empty.signatures.size,
    safeRejected: !emptySimulation.success,
    ...(emptySimulation.error ? { error: emptySimulation.error } : {}),
  })

  for (const [label, signer] of [
    ['alice', env.alice],
    ['bob', env.bob],
    ['carol', env.carol],
  ] as const) {
    const action = await signedAction(treasury, [signer], env.outsider.address)
    const simulation = await simulateTreasuryAction({
      treasury,
      action,
      caller: signer.address,
    })
    negative.push({
      label,
      signatures: action.signatures.size,
      safeRejected: !simulation.success,
      ...(simulation.error ? { error: simulation.error } : {}),
    })
  }

  const outsiderAction = await signedAction(treasury, [env.alice], env.outsider.address)
  let outsiderRejected = false
  try {
    await approveTreasuryAction({
      treasury,
      action: outsiderAction,
      signer: env.outsider,
    })
  } catch {
    outsiderRejected = true
  }
  const agentAction = await signedAction(treasury, [env.alice], env.outsider.address)
  let agentWalletRejected = false
  try {
    await approveTreasuryAction({
      treasury,
      action: agentAction,
      signer: env.agentWallet,
    })
  } catch {
    agentWalletRejected = true
  }
  let duplicateAction = await signedAction(
    treasury,
    [env.alice],
    env.outsider.address,
  )
  duplicateAction = await approveTreasuryAction({
    treasury,
    action: duplicateAction,
    signer: env.alice,
  })
  const duplicateSimulation = await simulateTreasuryAction({
    treasury,
    action: duplicateAction,
    caller: env.alice.address,
  })
  const duplicateRejected =
    duplicateAction.signatures.size === 1 && !duplicateSimulation.success

  const successfulSubsets = [
    ['alice+bob', [env.alice, env.bob]],
    ['alice+carol', [env.alice, env.carol]],
    ['bob+carol', [env.bob, env.carol]],
    ['alice+bob+carol', [env.alice, env.bob, env.carol]],
  ] as const
  const safeBalanceBeforeExecution = await uncachedPublicClient.getBalance({
    address: treasury.address,
  })
  const successful = []
  for (const [label, signers] of successfulSubsets) {
    const action = await signedAction(treasury, signers, env.outsider.address)
    const result = await executeTreasuryAction({
      treasury,
      action,
      executor: env.outsider,
    })
    successful.push({
      label,
      signers: signers.map(signer => signer.address),
      signatures: action.signatures.size,
      success: result.success,
      ...(result.transactionHash ? { transactionHash: result.transactionHash } : {}),
      ...(result.error ? { error: result.error } : {}),
    })
  }
  const safeBalanceAfterExecution = await waitForBalance(
    uncachedPublicClient,
    treasury.address,
    0n,
  )

  const expectedOwners = new Set(owners.map(owner => owner.address.toLowerCase()))
  const actualOwners = new Set(inspection.owners.map(owner => owner.toLowerCase()))
  const results = {
    deployedOfficialSafe: inspection.deployed && inspection.version === '1.4.1',
    exactOwners:
      expectedOwners.size === actualOwners.size &&
      [...expectedOwners].every(owner => actualOwners.has(owner)),
    exactThreshold: inspection.threshold === 2,
    agentWalletIsOwner: actualOwners.has(env.agentWallet.address.toLowerCase()),
    unexpectedModulesEnabled: inspection.modules.length > 0,
    unexpectedGuardConfigured: inspection.guard !== zeroAddress,
    unexpectedModuleGuardConfigured: inspection.moduleGuard !== zeroAddress,
    expectedFallbackHandler:
      inspection.fallbackHandler === getAddress(officialFallback.defaultAddress),
    emptyAndSingleOwnersRejected: negative.every(item => item.safeRejected),
    outsiderRejected,
    agentWalletRejected,
    duplicateRejected,
    allTwoOwnerCombinationsAccepted: successful.slice(0, 3).every(item => item.success),
    threeOwnersAccepted: successful[3]?.success === true,
    protectedValueMovedThroughSafe:
      successful.every(item => item.success) &&
      ((safeBalanceBeforeExecution >= 4n &&
        safeBalanceBeforeExecution - safeBalanceAfterExecution === 4n) ||
        (fundingVerified && safeBalanceAfterExecution === 0n)),
  }
  const pass =
    results.deployedOfficialSafe &&
    results.exactOwners &&
    results.exactThreshold &&
    !results.agentWalletIsOwner &&
    !results.unexpectedModulesEnabled &&
    !results.unexpectedGuardConfigured &&
    !results.unexpectedModuleGuardConfigured &&
    results.expectedFallbackHandler &&
    results.emptyAndSingleOwnersRejected &&
    results.outsiderRejected &&
    results.agentWalletRejected &&
    results.duplicateRejected &&
    results.allTwoOwnerCombinationsAccepted &&
    results.threeOwnersAccepted &&
    results.protectedValueMovedThroughSafe

  return {
    milestone: 'collective-control',
    provider: 'Safe',
    safeVersion: inspection.version,
    network: 'eip155:84532',
    safe: treasury.address,
    owners: inspection.owners,
    threshold: inspection.threshold,
    agentWallet: env.agentWallet.address,
    fallbackHandler: inspection.fallbackHandler,
    modules: inspection.modules,
    guard: inspection.guard,
    moduleGuard: inspection.moduleGuard,
    moduleGuardSupported: inspection.moduleGuardSupported,
    deploymentTransactionHash: deployment.transactionHash,
    fundingTransactionHash,
    balanceEvidence: {
      fundingVerified,
      beforeExecution: safeBalanceBeforeExecution.toString(),
      afterExecution: safeBalanceAfterExecution.toString(),
    },
    negative,
    successful,
    results,
    pass,
  }
}
