import { createPublicClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'

// Account derivation and local signing do not make requests through this client.
export const offlinePublicClient = createPublicClient({
  chain: baseSepolia,
  transport: http('http://127.0.0.1:8545'),
})
