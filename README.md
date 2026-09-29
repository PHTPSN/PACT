# Pact — Safe M-of-N custody and standard x402 payments

Pact currently proves two independent capabilities on Base Sepolia:

```text
Alice / Bob / Carol                 Standalone Agent Wallet
        |                                      |
        v                                      v
Safe M-of-N Treasury                standard x402 exact EVM
                                               |
                                               v
                                  Coinbase CDP hosted facilitator
                                               |
                                               v
                                     Base Sepolia USDC
```

There is no ownership, module, delegation, funding, or permission relationship
between the Safe and the Agent Wallet. Connecting them is intentionally deferred
to a later milestone.

## Installation and local checks

The repository uses npm and pins the architecture-critical Safe, CDP, x402, and
viem package versions in `package.json` and `package-lock.json`.

```bash
npm install
npm run build
npm test
```

`npm test` runs only deterministic unit tests. Live Base Sepolia tests are
explicit commands because they spend testnet funds and require network access.

Copy `.env.example` to `.env` and configure testnet-only private keys, the Base
Sepolia RPC URL, Coinbase CDP credentials, and the merchant address. Never use
production keys. If a proxy is required, set `HTTP_PROXY`, `HTTPS_PROXY`, and
keep localhost in `NO_PROXY`.

## Milestone 1: generic Safe M-of-N custody

The adapter accepts an arbitrary unique owner list and an integer threshold
where `1 <= M <= N`. It rejects empty owner sets, malformed or zero addresses,
duplicates, zero/fractional thresholds, and thresholds greater than the owner
count. The generic adapter supports M=1, but the claim that no individual can
act alone applies only when M is at least two.

The canonical proof uses Alice, Bob, and Carol with threshold two and Safe
v1.4.1. Safe contract authorization—not an application signature counter—guards
execution. The proof reads owners, threshold, modules, ordinary guard, and
fallback handler from the deployed Safe. Safe v1.4.1 does not implement the
newer module-guard feature, and that unsupported state is recorded explicitly.

```bash
npm run setup:milestone1
npm run test:milestone1-live
npm run demo:milestone1
```

The live proof checks empty and single-owner rejection at the Safe contract,
every two-owner combination, all three owners, outsider and Agent Wallet
rejection, duplicate-signature behavior, fresh Safe nonces, `ExecutionSuccess`
events, and protected value movement. It writes non-secret evidence to
`milestone1-result.json`.

## Milestone 2: standalone Agent Wallet x402 payment

The Agent Wallet directly holds test USDC and signs a standard x402 v2 exact-EVM
EIP-3009 `transferWithAuthorization`. The protected Express endpoint uses the
Coinbase CDP hosted facilitator for verification and settlement. It does not use
a local facilitator, a self-hosted facilitator, a CDP-managed payer wallet,
Permit2, ERC-7710, EIP-7702, or the Safe.

The selected profile is:

- Network: `eip155:84532` (Base Sepolia)
- Asset: official Base Sepolia USDC at
  `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Scheme: x402 v2 `exact`
- Authorization: EIP-3009 authorization flow
- Facilitator: Coinbase CDP hosted facilitator

Verify the hosted capability profile before running payments:

```bash
npm run check:milestone2-capabilities
```

This writes `milestone2-capabilities.json` without credentials or secret
headers. To run the endpoint and one paid request manually:

```bash
# terminal 1
npm run server:milestone2

# terminal 2
npm run demo:milestone2
```

The complete live suite performs an unpaid request, a successful payment,
onchain USDC `Transfer` verification, replay rejection without a duplicate
charge, a fresh repeat payment, and an insufficient-balance rejection:

```bash
npm run test:milestone2-live
```

It writes normalized non-secret evidence to `milestone2-result.json`. Raw payment
signatures, private keys, CDP API secrets, and bearer credentials are never
written to milestone artifacts.

## Full live verification

```bash
npm run test:integration
```

This command performs both live milestones and therefore spends Base Sepolia
ETH and USDC. The Safe and Agent Wallet remain architecturally independent.
