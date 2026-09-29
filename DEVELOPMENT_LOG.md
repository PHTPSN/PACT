# Development log

This log records architecture decisions, implementation work, verification, and
known limitations for the first two Pact milestones. It intentionally excludes
private keys, Coinbase CDP credentials, signed x402 payloads, and bearer tokens.

## 2026-09-29 — Architecture correction and live verification

### Scope and decision record

The pre-migration repository was captured in commit
`4340571e56b6bbaf6453797eef04ed67cdd16598` before changing either milestone.
The migration was completed in commit
`d1587a5741d82da0a76a339f82da980bd094dab5`.

The updated architecture intentionally keeps the two milestones independent:

- Milestone 1 is an official Safe M-of-N treasury owned by human test identities.
- Milestone 2 is a standalone Agent Wallet making standard x402 payments through
  the Coinbase CDP hosted facilitator.
- The Agent Wallet has no ownership, module, guard, delegation, funding, or
  permission relationship with the Safe.
- Connecting the Agent Wallet to treasury authority is deferred to a later
  milestone and was not simulated with a substitute mechanism.

### Milestone 1 — Generic Safe M-of-N treasury

Removed the prior MetaMask delegation-based treasury implementation and replaced
it with an adapter over the official Safe Protocol Kit. The adapter validates a
generic unique owner set and a threshold satisfying `1 <= M <= N`, then exposes
separate create, connect, propose, approve, execute, and inspect operations.

Architecture-critical versions were pinned:

- `@safe-global/protocol-kit@8.0.7`
- `@safe-global/safe-deployments@1.37.63`
- `@safe-global/types-kit@4.0.1`
- Safe contracts v1.4.1
- `viem@2.57.0`

Canonical Base Sepolia deployment:

| Item | Value |
| --- | --- |
| Network | `eip155:84532` |
| Safe | `0x7990aa16cFa09E9d5d619c10378320d1895eb3Ae` |
| Deployment transaction | `0xdc704492da0000fbc73b3a7407fc39a69a3384f39bd8f4c65593af392504e748` |
| Alice | `0x4D4b99E08556ba008F8d59148a295a07855Be9B8` |
| Bob | `0x601b9AB41DEB8eA6DbC250d2613b102A4297b8d1` |
| Carol | `0xAdC1B42536F3EAD7a16D70de99DD2db54d768f8A` |
| Threshold | `2` |
| Agent Wallet | `0x0e1cBC140a9356F32Feb7eB645C595b4C19E9e2F` (not an owner) |
| Modules | none |
| Guard | none |
| Fallback handler | `0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99` |

The fallback handler above is Safe's standard compatibility handler. It does not
grant the Agent Wallet authority and is not a replacement treasury implementation.
Safe v1.4.1 does not expose the newer module-guard feature; the inspector records
that feature as unsupported rather than claiming it is configured.

Execution success is accepted only when the receipt contains the Safe contract's
`ExecutionSuccess(bytes32,uint256)` event. An outer transaction receipt with a
successful status is insufficient evidence by itself.

Live verification passed for all required cases:

- Empty and every one-owner signature set reverted with Safe error `GS020`.
- Alice + Bob, Alice + Carol, and Bob + Carol each executed successfully.
- Alice + Bob + Carol executed successfully.
- Outsider and Agent Wallet signatures were rejected.
- A duplicate owner signature did not satisfy the threshold.
- Protected value moved through the Safe, with a verified balance transition from
  4 wei to 0 wei in the final proof.

Successful Safe action transactions:

| Signers | Transaction |
| --- | --- |
| Alice + Bob | `0x274d9df35e9d38825d4210c0b3225fb8d3555e6c81731045f04e349134bd78f2` |
| Alice + Carol | `0x92afe793be0cc302f12e1b32e370bc2b006fd3a89ac1294a79406b0b9ffe3e53` |
| Bob + Carol | `0x8aed92b28ca77e59f5508cfc5fc27ee446abdd6087e80cd155c538adb027f7d5` |
| Alice + Bob + Carol | `0xf0b8ec967bd12e9d7a23bfc1b6af01918d6648dec8c0cca2ea0a355915bca83e` |

The outsider account paid relay gas for fully signed Safe transactions. Relaying
does not grant authority: the Safe contract independently verifies owner
signatures and threshold before execution.

### Milestone 2 — Hosted-facilitator x402 payment

Removed the old ERC-7710 delegation path and locally controlled facilitator. The
replacement is the requested production-shaped boundary: the standalone Agent
Wallet signs x402 v2 exact-EVM payments, while Coinbase CDP's hosted facilitator
verifies and settles them on Base Sepolia.

Architecture-critical versions were pinned:

- `@coinbase/cdp-sdk@1.57.0`
- `@x402/core@2.27.0`
- `@x402/evm@2.27.0`
- `@x402/express@2.27.0`
- `@x402/fetch@2.27.0`
- `@x402/extensions@2.27.0`
- `@x402/svm@2.27.0`

The extensions and SVM packages are installed because the selected CDP SDK entry
point eagerly loads those peer packages. The payment path itself remains EVM-only.

The hosted capability query confirmed this profile before payment testing:

| Item | Value |
| --- | --- |
| Facilitator | `https://api.cdp.coinbase.com/platform/v2/x402` |
| Network | `eip155:84532` |
| Scheme | x402 v2 `exact` |
| Authorization | EIP-3009 `authorization` flow |
| Asset | Base Sepolia USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Asset metadata | name `USDC`, version `2`, 6 decimals |
| Merchant | `0xEb9F2A2eD4789C5CD6D66E8ea78b69A24A4BbD52` |

The complete live matrix passed:

- An unpaid request returned HTTP 402 with usable payment requirements.
- A paid request returned HTTP 200 and the protected resource.
- The receipt contained the expected USDC `Transfer` from Agent Wallet to merchant
  for the requested amount.
- Replaying the same signed authorization returned HTTP 402 without another charge.
- A fresh authorization produced a second successful on-chain payment.
- Insufficient-balance attempts returned HTTP 402 and did not produce a successful
  settlement.

Canonical live-payment transactions:

| Payment | Transaction |
| --- | --- |
| First matrix payment | `0x2dba3c2d10e7c6f3815e46b052785049d479078ecb4a5f85e8d8f5523617a940` |
| Fresh repeat | `0x6dbf69504ea83aacfff2e5133470ac4ba205fef4a85fbb5fd2d6f389bd3a4249` |

### Problems encountered and resolutions

1. Safe v1.4.1 does not implement module-guard inspection. The code now records
   `moduleGuardSupported: false`; it does not substitute or emulate the feature.
2. The human owner accounts had no ETH for gas. A non-owner relay account submits
   already-authorized Safe transactions, preserving Safe's authorization boundary.
3. The public Base RPC occasionally returned inconsistent observations near the
   chain tip. Verification now requires the Safe success event and uses bounded,
   uncached polling for the resulting latest balance.
4. The initial x402 price configuration omitted the EIP-712 USDC domain name and
   version. The run stopped before signing. The implementation was corrected to use
   the official Base Sepolia USDC metadata (`USDC`, version `2`) reported by the
   pinned x402/CDP capability profile.
5. The Base public RPC limits `eth_getLogs` to 1,000 blocks per query. Historical
   deployment lookup was completed with bounded 1,000-block ranges.

None of these resolutions replaced the requested service, protocol, trust boundary,
account type, settlement path, or external provider.

### Verification performed

The following checks passed after implementation:

```text
npm run build
npm test                         # 3 files, 15 tests
npm run test:milestone1-live     # 1 live test passed
npm run test:milestone2-live     # 1 live test passed
npm ls --depth=0
git diff --check
```

The two live suites were executed separately. The combined
`npm run test:integration` wrapper was not rerun afterward because it invokes those
same suites and would spend additional Base Sepolia ETH and USDC. No formatter or
linter script is currently configured.

Generated evidence is intentionally ignored by Git:

- `milestone1-result.json`
- `milestone2-capabilities.json`
- `milestone2-result.json`

These files contain normalized public proof data only. Raw signatures and secrets
are not persisted. `npm` currently reports two moderate dependency advisories; no
forced dependency upgrade was applied because that could introduce unrelated or
breaking changes.
