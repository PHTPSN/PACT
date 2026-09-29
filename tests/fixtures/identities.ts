import { privateKeyToAccount } from 'viem/accounts'

const testKey = (value: number) =>
  `0x${value.toString(16).padStart(64, '0')}` as const

export const alice = privateKeyToAccount(testKey(1))
export const bob = privateKeyToAccount(testKey(2))
export const carol = privateKeyToAccount(testKey(3))
export const agentSession = privateKeyToAccount(testKey(4))
export const outsider = privateKeyToAccount(testKey(5))
export const universalOutsider = privateKeyToAccount(testKey(6))

export const genericOwners = [alice, bob, carol, agentSession, outsider] as const
