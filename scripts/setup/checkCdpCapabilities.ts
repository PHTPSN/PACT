import 'dotenv/config'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  CDP_FACILITATOR_URL,
  createCdpFacilitatorClient,
} from '@coinbase/cdp-sdk/x402'
import { findDefaultAsset } from '@x402/evm'
import { ExactEvmScheme } from '@x402/evm/exact/server'

import {
  BASE_SEPOLIA_NETWORK,
  BASE_SEPOLIA_USDC,
} from '../../src/index.js'

if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET) {
  throw new Error('CDP_API_KEY_ID and CDP_API_KEY_SECRET must be configured.')
}

const facilitator = createCdpFacilitatorClient()
const supported = await facilitator.getSupported()
const exactBaseSepolia = supported.kinds.find(
  kind =>
    kind.x402Version === 2 &&
    kind.scheme === 'exact' &&
    kind.network === BASE_SEPOLIA_NETWORK,
)
if (!exactBaseSepolia) {
  throw new Error(
    'Mandatory stop: CDP does not advertise x402 v2 exact support for Base Sepolia.',
  )
}
const method = exactBaseSepolia.extra?.assetTransferMethod
if (method && method !== 'eip3009') {
  throw new Error(
    `Mandatory stop: CDP advertised assetTransferMethod ${String(method)}, not eip3009.`,
  )
}
const scheme = new ExactEvmScheme()
if (
  scheme.defaultAssetTransferMethod !== 'eip3009' ||
  !scheme.paymentFlows.eip3009.supported.includes('authorization')
) {
  throw new Error('Mandatory stop: the pinned EVM scheme is not EIP-3009 capable.')
}
const defaultAsset = findDefaultAsset(BASE_SEPOLIA_USDC, BASE_SEPOLIA_NETWORK)
if (!defaultAsset || defaultAsset.asset.toLowerCase() !== BASE_SEPOLIA_USDC.toLowerCase()) {
  throw new Error('Mandatory stop: the pinned Base Sepolia default asset is not USDC.')
}

const output = {
  checkedAt: new Date().toISOString(),
  facilitator: CDP_FACILITATOR_URL,
  requested: {
    x402Version: 2,
    scheme: 'exact',
    network: BASE_SEPOLIA_NETWORK,
    asset: BASE_SEPOLIA_USDC,
    assetTransferMethod: 'eip3009',
    paymentFlow: 'authorization',
  },
  advertisedKind: exactBaseSepolia,
  sdkScheme: {
    defaultAssetTransferMethod: scheme.defaultAssetTransferMethod,
    eip3009: scheme.paymentFlows.eip3009,
    defaultAsset,
  },
  extensions: supported.extensions,
}
const outputPath = resolve(
  process.env.MILESTONE2_CAPABILITIES_PATH ?? 'milestone2-capabilities.json',
)
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(output, null, 2))
