import { encodeFunctionData, erc20Abi, type Address, type Hex } from 'viem'

export function encodeErc20Transfer(
  recipient: Address,
  amount: bigint,
): Hex {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [recipient, amount],
  })
}
