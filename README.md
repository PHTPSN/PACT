# Pact — collective Safe budgets and standard x402 payments

Pact currently implements three narrow capabilities. Milestone 3 connects the
first two through an explicit, collectively approved operating-budget transfer:

```text
M-of-N Safe owners
        |
        v
operating-budget proposal
        |
        v
Safe ERC-20 transaction -- threshold approvals --> Agent Wallet
                                                    |
                                                    v
                                         standard x402 exact EVM
                                                    |
                                                    v
                                     Coinbase CDP hosted facilitator
```

The Agent Wallet is only the transfer recipient. It is not a Safe owner, module,
or guard and has no way to bypass the Safe threshold. Safe contract authorization
enforces M-of-N approval; Pact application policy restricts this particular
workflow to the configured Agent Wallet and configured ERC-20 tokens. Those are
separate guarantees.

The implementation history, architecture decisions, live transaction evidence,
and encountered issues are recorded in [`DEVELOPMENT_LOG.md`](DEVELOPMENT_LOG.md).

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

## Milestone 3: collective operating-budget issuance

`BudgetProposal` is the Pact domain object, and `BudgetIssuer` is the application
boundary. `SafeBudgetTreasuryAdapter` is the only Milestone 3 component that owns
Safe SDK transaction objects. It encodes one ERC-20 `transfer`, obtains the real
Safe transaction hash, signs it with configured Safe owners, and executes it
through the existing Milestone 1 treasury functions.

Amounts are integer token base units (`bigint`). Recipient, supported token,
decimals, Safe address, owners, threshold, signer combination, and network are
configuration or fixture inputs. The application reads the current Safe owners
and threshold and derives approvals from distinct owner signatures attached to
the Safe transaction; there is no parallel approval counter.

The default test suite uses a fake treasury adapter and needs no RPC, blockchain,
Coinbase account, or private key. It covers multiple M-of-N configurations,
multiple signer subsets, outsider and duplicate approvals, ERC-20 encoding,
validation, exact balance accounting, audit events, and idempotent execution.

The live test is separate and opt-in:

```bash
# Configure RUN_LIVE_M3=true and the Milestone 3 variables in .env first.
npm run test:milestone3-live
```

It connects to `SAFE_ADDRESS`, queries its actual owners and threshold, and uses
`OWNER_PRIVATE_KEY_1`, `OWNER_PRIVATE_KEY_2`, and further consecutively numbered
keys as needed. It refuses to run if too few configured keys belong to current
Safe owners, the Agent Wallet is a Safe owner, token decimals disagree with the
contract, or the Safe lacks the requested token amount. It attempts execution
below threshold, signs until the actual threshold is reached, verifies the
receipt and exact Safe/Agent Wallet token deltas, and confirms a replay does not
move funds again. Non-secret evidence is written to `milestone3-result.json`.
An optional `EXECUTOR_PRIVATE_KEY` may identify a gas-paying relay; the relay
does not contribute an approval and need not be a Safe owner.
Post-receipt balance reads use bounded uncached polling to tolerate public-RPC
indexing lag without weakening the exact-delta assertions.

The separate M3→M2 smoke test is also opt-in:

```bash
# Configure RUN_LIVE_M3_X402=true and the MILESTONE3_X402_* values first.
npm run test:milestone3-x402-smoke
```

It reads an `exact` payment requirement from the existing premium endpoint,
rejects a payment larger than the configured budget, issues the budget through
the Safe, and then pays through Coinbase CDP's hosted facilitator. It verifies
the Safe, Agent Wallet, and merchant token deltas independently and writes
non-secret evidence to `milestone3-x402-result.json`.

The current proposal/action store is deliberately in memory. Restart recovery
would require a durable proposal store and a Safe Transaction Service integration;
neither changes the authorization boundary, but neither is claimed by this MVP.

## Full live verification

```bash
npm run test:integration
```

This command discovers all three live suites. Milestone 3 remains skipped unless
`RUN_LIVE_M3=true`; when enabled, it spends the configured chain's gas token and
ERC-20 balance. Milestone 2 continues to use Coinbase CDP's hosted facilitator;
Milestone 3 does not replace or modify that settlement path.
