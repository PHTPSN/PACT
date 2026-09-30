import 'dotenv/config'
import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createPublicClient,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  isHex,
  type Address,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import {
  BASE_SEPOLIA_NETWORK,
  InMemoryBudgetIssuer,
  SafeBudgetTreasuryAdapter,
  connectDeployedTreasury,
  createPaidFetch,
  createPremiumServer,
  type TreasurySigner,
} from '../../src/index.js'

const enabled = process.env.RUN_LIVE_M3_X402 === 'true'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}.`)
  return value
}

function configuredRpcUrl(): string {
  return (
    process.env.RPC_URL ??
    process.env.BASE_SEPOLIA_RPC_URL ??
    required('RPC_URL')
  )
}

function address(name: string, fallbackName?: string): Address {
  const value = process.env[name] ?? (fallbackName ? process.env[fallbackName] : undefined)
  if (!value) throw new Error(`Missing ${name}.`)
  if (!isAddress(value, { strict: false })) {
    throw new Error(`${name} must be an EVM address.`)
  }
  return getAddress(value)
}

function signer(name: string, value = required(name)): TreasurySigner {
  if (!isHex(value) || value.length !== 66) {
    throw new Error(`${name} must be a 32-byte 0x-prefixed private key.`)
  }
  const privateKey = value as `0x${string}`
  return { address: privateKeyToAccount(privateKey).address, privateKey }
}

function ownerSigners(): TreasurySigner[] {
  const entries = Object.entries(process.env)
    .flatMap(([name, value]) => {
      const match = /^OWNER_PRIVATE_KEY_(\d+)$/.exec(name)
      return match && value ? [{ index: Number(match[1]), name, value }] : []
    })
    .sort((left, right) => left.index - right.index)
  if (entries.length === 0) {
    throw new Error('At least OWNER_PRIVATE_KEY_1 must be configured.')
  }
  return entries.map(({ name, value }) => signer(name, value))
}

function paymentRequirement(response: Response, tokenAddress: Address) {
  const header = response.headers.get('payment-required')
  if (!header) throw new Error('The x402 endpoint omitted PAYMENT-REQUIRED.')
  const payload = JSON.parse(
    Buffer.from(header, 'base64').toString('utf8'),
  ) as {
    accepts?: Array<{
      scheme?: string
      network?: string
      asset?: string
      amount?: string
      payTo?: string
    }>
  }
  const selected = payload.accepts?.find(
    candidate =>
      candidate.scheme === 'exact' &&
      candidate.network === BASE_SEPOLIA_NETWORK &&
      candidate.asset?.toLowerCase() === tokenAddress.toLowerCase(),
  )
  if (!selected?.amount || !selected.payTo) {
    throw new Error('The endpoint did not offer the expected exact-EVM token payment.')
  }
  return {
    amount: BigInt(selected.amount),
    payTo: getAddress(selected.payTo),
  }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, reject) => {
    server.close(error => (error ? reject(error) : resolveClose()))
  })
}

async function tokenBalance(
  client: ReturnType<typeof createPublicClient>,
  token: Address,
  holder: Address,
): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [holder],
  })
}

describe.skipIf(!enabled)('Milestone 3 to Milestone 2 x402 smoke test', () => {
  it('uses a collectively approved budget for one hosted-facilitator payment', async () => {
    const rpcUrl = configuredRpcUrl()
    const safeAddress = address('SAFE_ADDRESS')
    const agentWalletAddress = address('AGENT_WALLET_ADDRESS')
    const tokenAddress = address('TOKEN_ADDRESS')
    const payTo = address(
      'MILESTONE3_X402_PAY_TO_ADDRESS',
      'MILESTONE2_PAY_TO_ADDRESS',
    )
    if (
      payTo === safeAddress ||
      payTo === agentWalletAddress
    ) {
      throw new Error('The smoke-test merchant must differ from the Safe and Agent Wallet.')
    }
    const tokenDecimals = Number(required('TOKEN_DECIMALS'))
    const budgetAmount = BigInt(required('MILESTONE3_X402_BUDGET_ATOMIC'))
    const endpointPrice = BigInt(required('MILESTONE3_X402_PAYMENT_ATOMIC'))
    if (budgetAmount <= 0n || endpointPrice <= 0n) {
      throw new Error('Smoke-test budget and payment amounts must be positive.')
    }

    const publicClient = createPublicClient({ cacheTime: 0, transport: http(rpcUrl) })
    const chainId = await publicClient.getChainId()
    if (chainId !== 84532) {
      throw new Error(`The existing x402 client requires Base Sepolia; received ${chainId}.`)
    }
    const treasury = await connectDeployedTreasury({ provider: rpcUrl, safeAddress })
    const ownerSet = new Set(
      treasury.config.owners.map(owner => owner.toLowerCase()),
    )
    if (ownerSet.has(agentWalletAddress.toLowerCase())) {
      throw new Error('The Agent Wallet must not be a Safe owner.')
    }
    const signers = ownerSigners()
    const validOwnerSigners = signers.filter(candidate =>
      ownerSet.has(candidate.address.toLowerCase()),
    )
    if (validOwnerSigners.length < treasury.config.threshold) {
      throw new Error(
        `Only ${validOwnerSigners.length} configured key(s) match Safe owners; ${treasury.config.threshold} required.`,
      )
    }
    const agentSigner = signer('AGENT_WALLET_PRIVATE_KEY')
    if (agentSigner.address !== agentWalletAddress) {
      throw new Error('AGENT_WALLET_PRIVATE_KEY does not match AGENT_WALLET_ADDRESS.')
    }

    const server = createPremiumServer({ payTo, amount: endpointPrice }).listen(
      0,
      '127.0.0.1',
    )
    await once(server, 'listening')
    try {
      const bound = server.address()
      if (!bound || typeof bound === 'string') {
        throw new Error('Failed to bind the smoke-test x402 endpoint.')
      }
      const endpoint = `http://127.0.0.1:${bound.port}/premium`
      const unpaid = await fetch(endpoint, {
        headers: { accept: 'application/json' },
      })
      const requirement = paymentRequirement(unpaid, tokenAddress)
      if (requirement.payTo !== payTo) {
        throw new Error('The endpoint payment recipient does not match configuration.')
      }
      if (requirement.amount > budgetAmount) {
        throw new Error(
          `Endpoint payment ${requirement.amount} exceeds budget ${budgetAmount}.`,
        )
      }

      const balance = (holder: Address): Promise<bigint> =>
        tokenBalance(publicClient, tokenAddress, holder)
      const [safeBefore, agentBefore, merchantBefore] = await Promise.all([
        balance(treasury.address),
        balance(agentWalletAddress),
        balance(payTo),
      ])
      if (safeBefore < budgetAmount) {
        throw new Error(
          `Safe balance ${safeBefore} is below smoke-test budget ${budgetAmount}.`,
        )
      }

      const adapter = new SafeBudgetTreasuryAdapter({
        treasury,
        signers,
        executor: process.env.EXECUTOR_PRIVATE_KEY
          ? signer('EXECUTOR_PRIVATE_KEY')
          : validOwnerSigners[0]!,
      })
      const issuer = new InMemoryBudgetIssuer({
        config: {
          agentWalletAddress,
          tokens: [
            {
              address: tokenAddress,
              symbol: process.env.TOKEN_SYMBOL ?? 'TOKEN',
              decimals: tokenDecimals,
            },
          ],
        },
        treasury: adapter,
      })
      let proposal = await issuer.createProposal({
        treasuryAddress: treasury.address,
        recipientAddress: agentWalletAddress,
        tokenAddress,
        tokenDecimals,
        amount: budgetAmount,
        memo: 'Milestone 3 to x402 live smoke test',
      })
      for (const owner of validOwnerSigners.slice(0, treasury.config.threshold)) {
        proposal = await issuer.approveProposal({
          proposalId: proposal.id,
          signer: owner.address,
        })
      }
      const budget = await issuer.executeProposal(proposal.id)
      if (!budget.executionTxHash) {
        throw new Error('Budget execution omitted its transaction hash.')
      }
      const agentAfterBudget = await balance(agentWalletAddress)

      const paidFetch = createPaidFetch({
        agentWalletAccount: privateKeyToAccount(agentSigner.privateKey),
        maximumPaymentAmount: requirement.amount,
        expectedPayTo: payTo,
      })
      const payment = await paidFetch<{ recommendation: { primaryMarket: string } }>(endpoint, {
        headers: { accept: 'application/json' },
      })
      const paymentReceipt = await publicClient.getTransactionReceipt({
        hash: payment.settlement.transaction as `0x${string}`,
      })

      let agentAfterPayment = agentAfterBudget
      let merchantAfter = merchantBefore
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const balances = await Promise.all([
          balance(agentWalletAddress),
          balance(payTo),
        ])
        agentAfterPayment = balances[0]
        merchantAfter = balances[1]
        if (
          agentAfterBudget - agentAfterPayment === requirement.amount &&
          merchantAfter - merchantBefore === requirement.amount
        ) {
          break
        }
        await new Promise(resolveWait => setTimeout(resolveWait, 1_000))
      }
      const safeAfter = await balance(treasury.address)

      const results = {
        initialResponseRequiredPayment: unpaid.status === 402,
        paymentWithinBudget: requirement.amount <= budgetAmount,
        safeBudgetDelta: safeBefore - safeAfter === budgetAmount,
        agentReceivedBudget: agentAfterBudget - agentBefore === budgetAmount,
        paymentSettled:
          payment.response.status === 200 &&
          payment.settlement.success &&
          paymentReceipt.status === 'success',
        agentPaidRequiredAmount:
          agentAfterBudget - agentAfterPayment === requirement.amount,
        merchantReceivedRequiredAmount:
          merchantAfter - merchantBefore === requirement.amount,
        finalAgentDelta:
          agentAfterPayment - agentBefore === budgetAmount - requirement.amount,
      }
      const evidence = {
        milestone: 'collective-budget-to-x402-smoke',
        network: BASE_SEPOLIA_NETWORK,
        safeAddress: treasury.address,
        threshold: treasury.config.threshold,
        approvals: budget.approvals,
        agentWalletAddress,
        tokenAddress,
        tokenDecimals,
        merchant: payTo,
        budgetAmount: budgetAmount.toString(),
        paymentRequirement: requirement.amount.toString(),
        safeTxHash: budget.safeTxHash,
        budgetExecutionTxHash: budget.executionTxHash,
        paymentTxHash: payment.settlement.transaction,
        balances: {
          safeBefore: safeBefore.toString(),
          safeAfter: safeAfter.toString(),
          agentBefore: agentBefore.toString(),
          agentAfterBudget: agentAfterBudget.toString(),
          agentAfterPayment: agentAfterPayment.toString(),
          merchantBefore: merchantBefore.toString(),
          merchantAfter: merchantAfter.toString(),
        },
        results,
      }
      await writeFile(
        resolve(
          process.env.MILESTONE3_X402_RESULT_PATH ??
            'milestone3-x402-result.json',
        ),
        `${JSON.stringify(evidence, null, 2)}\n`,
        'utf8',
      )
      expect(Object.values(results).every(Boolean)).toBe(true)
    } finally {
      await closeServer(server)
    }
  }, 300_000)
})
