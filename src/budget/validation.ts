import { getAddress, isAddress, zeroAddress, type Address } from 'viem'

import { BudgetValidationError } from './errors.js'
import type {
  CreateBudgetProposalInput,
  PactRuntimeConfig,
  TokenConfig,
} from './types.js'

function validAddress(value: string, label: string): Address {
  if (!isAddress(value, { strict: false })) {
    throw new BudgetValidationError(`${label} is not a valid address.`)
  }
  const normalized = getAddress(value)
  if (normalized.toLowerCase() === zeroAddress) {
    throw new BudgetValidationError(`${label} must not be the zero address.`)
  }
  return normalized
}

function validDecimals(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) {
    throw new BudgetValidationError(
      'Token decimals must be an integer between 0 and 255.',
    )
  }
  return value
}

export function validateRuntimeConfig(
  config: PactRuntimeConfig,
): Readonly<PactRuntimeConfig> {
  const agentWalletAddress = validAddress(
    config.agentWalletAddress,
    'Agent Wallet address',
  )
  if (!Array.isArray(config.tokens) || config.tokens.length === 0) {
    throw new BudgetValidationError('At least one budget token is required.')
  }
  const tokens: TokenConfig[] = config.tokens.map((token, index) => ({
    address: validAddress(token.address, `Token at index ${index}`),
    symbol: token.symbol.trim(),
    decimals: validDecimals(token.decimals),
  }))
  if (tokens.some(token => token.symbol.length === 0)) {
    throw new BudgetValidationError('Token symbols must not be empty.')
  }
  if (
    new Set(tokens.map(token => token.address.toLowerCase())).size !== tokens.length
  ) {
    throw new BudgetValidationError('Configured budget tokens must be unique.')
  }
  return Object.freeze({
    agentWalletAddress,
    tokens: Object.freeze(tokens.map(token => Object.freeze(token))),
  })
}

export function validateProposalInput(
  config: Readonly<PactRuntimeConfig>,
  input: CreateBudgetProposalInput,
): CreateBudgetProposalInput {
  const treasuryAddress = validAddress(input.treasuryAddress, 'Treasury address')
  const recipientAddress = validAddress(input.recipientAddress, 'Recipient address')
  const tokenAddress = validAddress(input.tokenAddress, 'Token address')
  if (recipientAddress !== config.agentWalletAddress) {
    throw new BudgetValidationError(
      'Operating budgets may only be issued to the configured Agent Wallet.',
    )
  }
  const token = config.tokens.find(
    candidate => candidate.address.toLowerCase() === tokenAddress.toLowerCase(),
  )
  if (!token) {
    throw new BudgetValidationError('The requested token is not configured.')
  }
  if (input.tokenDecimals !== token.decimals) {
    throw new BudgetValidationError(
      `Token decimals must match the configured value ${token.decimals}.`,
    )
  }
  if (input.amount <= 0n) {
    throw new BudgetValidationError('Budget amount must be greater than zero.')
  }
  return {
    treasuryAddress,
    recipientAddress,
    tokenAddress,
    tokenDecimals: token.decimals,
    amount: input.amount,
    ...(input.memo === undefined ? {} : { memo: input.memo }),
  }
}
