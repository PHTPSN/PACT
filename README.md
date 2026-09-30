# Pact — collective Safe budgets and standard x402 payments

Pact currently implements five narrow capabilities. Milestone 3 connects the
first two through an explicit, collectively approved operating-budget transfer,
Milestone 4 adds an independent economic-ownership path, and Milestone 5 gives
Qwen a bounded tool runtime that can spend only from the Agent Wallet:

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

Immutable economic ownership
        |
        v
Splits V2.2 PushSplit -- permissionless distribution --> team recipients

Qwen task -- inspect quote --> bounded paidFetch --> useful market brief
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

## Milestone 4: protected economic rights

`RevenueSplit` is the Pact domain object, `RevenueSplitService` is the
application service, and `RevenueSplitAdapter` is the protocol boundary.
`SplitsV2PushSplitAdapter` is the only component that owns official Splits V2.2
contract structs, ABIs, deployment addresses, event logs, and wallet clients.

Milestone 4 creates an official V2.2 PushSplit with `owner` set to the zero
address at initialization. The deployer receives no control, and the creator
metadata field is also set to zero. The adapter independently reads `owner()`,
`splitHash()`, `updateBlockNumber()`, the V2.2 EIP-712 domain, proxy bytecode,
and the authoritative `SplitUpdated` event. It accepts the split only when the
bytecode identifies an official PushSplit, the owner is zero, and a locally
recomputed hash of the event configuration equals the stored hash.

Pact allocations are integer basis points and must total exactly 10,000. The
underlying protocol permits arbitrary totals, so this is intentionally enforced
at the Pact boundary. The adapter passes integer basis points directly to the
official factory ABI instead of using the SDK convenience API's floating-point
percentage representation. Token quantities use `bigint` throughout.

PushSplit V2.2 full-balance distribution leaves one atomic unit in every
non-empty Split/Warehouse balance. Each recipient amount is independently
floored with Solidity integer division, and any additional division remainder
stays in the PushSplit. Deterministic tests encode both rules. The live test
derives the smallest funding amount whose distributable portion divides exactly
across the configured allocations; no live amount variable is required.

The Agent Wallet, Safe, and deployer gain no control or revenue merely because
of their operational roles. If explicitly listed as recipients, they receive
only their configured share and still have no mutation authority. Milestone 4
does not fund the Agent Wallet, invoke Safe approvals, call Qwen, or use x402.

The live test is separate and opt-in:

```bash
# Configure RUN_LIVE_M4=true and the Milestone 4 variables in .env first.
npm run test:milestone4-live
```

It reuses the existing RPC, token, outsider test wallet, Safe, and Agent Wallet
configuration. It creates a fresh immutable PushSplit, reads back and hashes the
authoritative configuration, transfers the derived small ERC-20 amount to it,
distributes, uses bounded uncached balance polling, checks exact recipient deltas,
and verifies that the Agent Wallet, Safe, and deployer receive nothing unless
configured as recipients. Non-secret evidence is written to
`milestone4-result.json`.

## Milestone 5: Kiln/Qwen agent runtime

Milestone 5 integrates the previously isolated `kiln-temp` runtime under
`src/agent`. The bounded loop, strict Zod schemas, Kiln-only Qwen client,
normalized audit events, mocks, and exact five-tool allowlist are preserved.
Pact-specific code lives behind four narrow ports:

- `PactTreasuryReader` calls the existing Safe inspection code and reads the
  configured ERC-20 balance.
- `PactBudgetReader` reads capital already held by the Agent Wallet; it cannot
  propose or issue a Safe budget.
- `PactPaymentGateway` uses the unsigned M2 quote inspector and delegates every
  paid request to the existing `createPaidFetch` EIP-3009 client.
- `InMemoryAuditLog` supplies the read-only M5 audit source and emitter without
  adding persistence.

The model never receives wallet objects, keys, signatures, raw transactions, or
x402 headers. Safe governance, budget issuance, spending-limit mutation, and M4
Split mutation are absent from the tool registry. The only tools are
`getTreasuryState`, `getOperatingBudget`, `inspectPaidResource`, `paidFetch`, and
`getAuditHistory`.

Run the deterministic integration gate with:

```bash
npm run test:milestone5-gate1
```

Gate 2 uses live Kiln/Qwen3-32B but deterministic mock adapters. It requires
`KILN_API_KEY` and explicit `RUN_LIVE_QWEN=true`:

```bash
npm run test:milestone5-qwen-live
```

Gate 3 uses the configured, already-funded Agent Wallet and the existing hosted-
facilitator x402 path. It does not issue a Safe budget. Configure
`MILESTONE5_PAID_RESOURCE_URL`, `MILESTONE5_MAX_PAYMENT_ATOMIC`, and the existing
chain/wallet variables, then explicitly set `RUN_LIVE_M5=true`:

```bash
npm run test:milestone5-live
```

Both live flags default to `false`. The live assertion checks structured tool
records, HTTP status, resource presence, a provider-returned transaction hash,
and its onchain receipt instead of matching Qwen prose.

## Milestone 6: productization and demo hardening

M6 adds an interactive product application in [`product`](product), served by
[`src/product`](src/product), without changing the M1–M5 protocol architecture.
Its three working views consume the same local SQLite state:

- **Team Pact** guides member verification, founding acceptance, the approval
  rule, and immutable revenue ownership.
- **AI Treasurer** shows the jointly controlled Safe treasury, approved Agent
  Wallet budget, Qwen task, tool execution, x402 receipt, and remaining exposure.
- **Controls & Audit** reconstructs member approvals, bounded capital issuance,
  immutable revenue ownership, and normalized evidence in chronological order.

The product-state database is an evidence and presentation layer only. Safe
contract authorization, the Agent Wallet's onchain balance, Coinbase CDP's
hosted x402 facilitator, and the immutable Splits contract remain the financial
authorities. Raw private keys, signatures, and x402 authorization headers are
never persisted.

The paid endpoint now returns a deterministic launch-market brief rather than
`{"premiumData":"hello"}`. Qwen needs that paid result to compare Seoul,
Singapore, and Tokyo and select the strongest launch market; the standard x402
payment and hosted-facilitator settlement path are unchanged.

```bash
npm ci
npm run build
npm run product:start
```

Open `http://127.0.0.1:4180`. The product has a guarded **Reset scenario**
action. Reset deletes and recreates only normalized product-demo records; it
cannot move funds, modify the Safe, change the Split, issue a live budget, or
replay a payment. Product interactions are clearly labeled as sandbox state and
link to independently verifiable Base Sepolia evidence. The complete demo flow
and submission evidence are in [`DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md).

### Render deployment

The root [`render.yaml`](render.yaml) defines a free Node web service. Render
injects `PORT`; the server binds to `0.0.0.0` and serves both the product UI and
API. The free service filesystem is ephemeral, so its local SQLite scenario
state resets whenever Render restarts, redeploys, or spins the service down.
This is acceptable for the seeded demo but is not durable production storage.

## Full live verification

```bash
npm run test:integration
```

This command discovers all four live suites. Milestones 3 and 4 remain skipped
unless their respective `RUN_LIVE_*` flags are enabled; when enabled, they spend
the configured chain's gas token and ERC-20 balance. Milestone 2 continues to use
Coinbase CDP's hosted facilitator; neither Milestone 3 nor Milestone 4 replaces
or modifies that settlement path.
