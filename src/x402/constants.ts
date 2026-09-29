import type { Address } from 'viem'

export const BASE_SEPOLIA_NETWORK = 'eip155:84532' as const
export const BASE_SEPOLIA_CHAIN_ID = 84532
export const BASE_SEPOLIA_USDC =
  '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address
export const BASE_SEPOLIA_USDC_DECIMALS = 6
export const BASE_SEPOLIA_USDC_EIP712_NAME = 'USDC'
export const BASE_SEPOLIA_USDC_EIP712_VERSION = '2'

export const ONE_USDC = 1_000_000n
export const TEN_CENTS_USDC = 100_000n
