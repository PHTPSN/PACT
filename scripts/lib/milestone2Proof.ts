import { once } from 'node:events'
import type { Server } from 'node:http'

import { erc20Abi, getAddress, parseEventLogs, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import {
  BASE_SEPOLIA_NETWORK,
  BASE_SEPOLIA_USDC,
  TEN_CENTS_USDC,
  createPaidFetch,
  createPremiumServer,
} from '../../src/index.js'
import { loadLiveEnvironment } from '../../tests/fixtures/liveEnvironment.js'

type CapturedPaymentHeader = { name: string; value: string }

async function startServer(payTo: Address, amount: bigint) {
  const app = createPremiumServer({ payTo, amount })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind the Milestone 2 proof server.')
  }
  return {
    server,
    endpoint: `http://127.0.0.1:${address.port}/premium`,
  }
}
async function closeServer(server: Server): Promise<void> {
  server.close()
  await once(server, 'close')
}

function decodePaymentRequired(response: Response): Record<string, unknown> {
  const header = response.headers.get('payment-required')
  if (!header) throw new Error('HTTP 402 response omitted PAYMENT-REQUIRED.')
  return JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as Record<
    string,
    unknown
  >
}

function capturePaymentFetch(onCapture: (header: CapturedPaymentHeader) => void) {
  const wrapped: typeof globalThis.fetch = async (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value))
    for (const name of ['payment-signature', 'x-payment']) {
      const value = headers.get(name)
      if (value) onCapture({ name, value })
    }
    return globalThis.fetch(input, init)
  }
  return wrapped
}

async function tokenBalance(
  publicClient: ReturnType<typeof loadLiveEnvironment>['publicClient'],
  owner: Address,
) {
  return publicClient.readContract({
    address: BASE_SEPOLIA_USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [owner],
  })
}

export async function runMilestone2Proof() {
  if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET) {
    throw new Error('CDP_API_KEY_ID and CDP_API_KEY_SECRET must be configured.')
  }
  const env = loadLiveEnvironment()
  const chainId = await env.publicClient.getChainId()
  const payTo = getAddress(process.env.MILESTONE2_PAY_TO_ADDRESS ?? env.outsider.address)
  const agentAccount = privateKeyToAccount(env.agentWallet.privateKey)
  const canonical = await startServer(payTo, TEN_CENTS_USDC)

  try {
    const unpaidResponse = await fetch(canonical.endpoint, {
      headers: { accept: 'application/json' },
    })
    const unpaidBody = await unpaidResponse.clone().json() as Record<string, unknown>
    const unpaidRequirements = decodePaymentRequired(unpaidResponse)

    const payerBefore = await tokenBalance(env.publicClient, agentAccount.address)
    const recipientBefore = await tokenBalance(env.publicClient, payTo)
    let capturedPayment: CapturedPaymentHeader | undefined
    const paidFetch = createPaidFetch({
      agentWalletAccount: agentAccount,
      maximumPaymentAmount: TEN_CENTS_USDC,
      expectedPayTo: payTo,
      fetch: capturePaymentFetch(header => {
        capturedPayment = header
      }),
    })
    const first = await paidFetch<{ recommendation: { primaryMarket: string } }>(canonical.endpoint, {
      headers: { accept: 'application/json' },
    })
    if (!capturedPayment) throw new Error('The signed payment header was not captured.')

    const firstReceipt = await env.publicClient.getTransactionReceipt({
      hash: first.settlement.transaction as `0x${string}`,
    })
    const transferEvents = parseEventLogs({
      abi: erc20Abi,
      logs: firstReceipt.logs,
      eventName: 'Transfer',
    })
    const expectedTransfer = transferEvents.find(event =>
      event.address.toLowerCase() === BASE_SEPOLIA_USDC.toLowerCase() &&
      getAddress(event.args.from) === getAddress(agentAccount.address) &&
      getAddress(event.args.to) === payTo &&
      event.args.value === TEN_CENTS_USDC,
    )
    const payerAfterFirst = await tokenBalance(env.publicClient, agentAccount.address)
    const recipientAfterFirst = await tokenBalance(env.publicClient, payTo)

    const replayHeader = capturedPayment as CapturedPaymentHeader
    const replayResponse = await fetch(canonical.endpoint, {
      headers: {
        accept: 'application/json',
        [replayHeader.name]: replayHeader.value,
      },
    })
    const payerAfterReplay = await tokenBalance(env.publicClient, agentAccount.address)
    const recipientAfterReplay = await tokenBalance(env.publicClient, payTo)

    const second = await paidFetch<{ premiumData: string }>(canonical.endpoint, {
      headers: { accept: 'application/json' },
    })
    const secondReceipt = await env.publicClient.getTransactionReceipt({
      hash: second.settlement.transaction as `0x${string}`,
    })
    const payerAfterSecond = await tokenBalance(env.publicClient, agentAccount.address)
    const recipientAfterSecond = await tokenBalance(env.publicClient, payTo)

    const insufficientPrice = payerAfterSecond + 1n
    const insufficient = await startServer(payTo, insufficientPrice)
    let insufficientRejected = false
    let insufficientStatuses: number[] = []
    try {
      const insufficientFetch: typeof globalThis.fetch = async (input, init) => {
        const response = await fetch(input, init)
        insufficientStatuses.push(response.status)
        return response
      }
      const attempt = createPaidFetch({
        agentWalletAccount: agentAccount,
        maximumPaymentAmount: insufficientPrice,
        expectedPayTo: payTo,
        fetch: insufficientFetch,
      })
      await attempt(insufficient.endpoint, { headers: { accept: 'application/json' } })
    } catch {
      insufficientRejected = true
    } finally {
      await closeServer(insufficient.server)
    }
    const payerAfterInsufficient = await tokenBalance(env.publicClient, agentAccount.address)
    const recipientAfterInsufficient = await tokenBalance(env.publicClient, payTo)

    const results = {
      unpaidRequest:
        unpaidResponse.status === 402 &&
        unpaidBody.error === 'payment_required' &&
        Array.isArray(unpaidRequirements.accepts),
      successfulPayment:
        first.response.status === 200 &&
        first.resource.recommendation.primaryMarket === 'Seoul' &&
        first.settlement.success,
      onchainEvidence:
        firstReceipt.status === 'success' &&
        chainId === 84532 &&
        Boolean(expectedTransfer) &&
        payerBefore - payerAfterFirst === TEN_CENTS_USDC &&
        recipientAfterFirst - recipientBefore === TEN_CENTS_USDC,
      replayRejectedWithoutCharge:
        replayResponse.status !== 200 &&
        payerAfterReplay === payerAfterFirst &&
        recipientAfterReplay === recipientAfterFirst,
      freshRepeatSucceeded:
        second.response.status === 200 &&
        secondReceipt.status === 'success' &&
        second.settlement.transaction !== first.settlement.transaction &&
        payerAfterReplay - payerAfterSecond === TEN_CENTS_USDC &&
        recipientAfterSecond - recipientAfterReplay === TEN_CENTS_USDC,
      insufficientBalanceRejected:
        insufficientRejected &&
        !insufficientStatuses.includes(200) &&
        payerAfterInsufficient === payerAfterSecond &&
        recipientAfterInsufficient === recipientAfterSecond,
    }
    return {
      milestone: 'x402-payment-viability',
      provider: 'Coinbase CDP hosted facilitator',
      protocolVersion: 2,
      scheme: 'exact',
      authorizationMethod: 'eip3009',
      paymentFlow: 'authorization',
      network: BASE_SEPOLIA_NETWORK,
      asset: BASE_SEPOLIA_USDC,
      agentWallet: agentAccount.address,
      endpoint: canonical.endpoint,
      initialStatus: unpaidResponse.status,
      finalStatus: first.response.status,
      paymentAmount: TEN_CENTS_USDC.toString(),
      recipient: payTo,
      transactionHash: first.settlement.transaction,
      repeatTransactionHash: second.settlement.transaction,
      replayStatus: replayResponse.status,
      insufficientStatuses,
      resourceReceived: first.resource.recommendation.primaryMarket === 'Seoul',
      results,
      pass: Object.values(results).every(Boolean),
    }
  } finally {
    await closeServer(canonical.server)
  }
}
