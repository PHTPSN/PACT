import { privateKeyToAccount } from 'viem/accounts'

const testKey = (value: number) =>
  `0x${value.toString(16).padStart(64, '0')}` as const

export const aliceKey = testKey(1)
export const bobKey = testKey(2)
export const carolKey = testKey(3)
export const agentWalletKey = testKey(4)
export const outsiderKey = testKey(5)
export const universalOutsiderKey = testKey(6)

export const alice = privateKeyToAccount(aliceKey)
export const bob = privateKeyToAccount(bobKey)
export const carol = privateKeyToAccount(carolKey)
export const agentWallet = privateKeyToAccount(agentWalletKey)
export const outsider = privateKeyToAccount(outsiderKey)
export const universalOutsider = privateKeyToAccount(universalOutsiderKey)

export const genericOwners = [alice, bob, carol, agentWallet, outsider] as const
