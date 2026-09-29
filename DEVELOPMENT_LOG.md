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

## Milestone 3 — Collective budget issuance

Milestone 3 adds a domain-level `BudgetProposal` and `BudgetIssuer` application
service above a `BudgetTreasuryAdapter` port. Safe SDK transaction objects remain
inside `SafeBudgetTreasuryAdapter`; they are not used as Pact domain records.

The workflow creates one Safe transaction containing an ERC-20 `transfer` to the
configured Agent Wallet. The adapter reads the deployed Safe's current owners and
threshold and derives approvals from distinct owner signatures attached to that
transaction. Pact constrains the recipient and allowed token at the application
boundary; the Safe contract independently enforces M-of-N authorization. No
module, guard, custom contract, ERC-7710 flow, or alternative facilitator was
introduced.

Execution is idempotent within the application instance and Safe nonce semantics
prevent an already-executed transaction from succeeding on-chain again. The
successful execution record includes the outer transaction hash, execution time,
and before/after token balances for both Safe and Agent Wallet. Normalized budget
audit events contain public transaction metadata but no keys or signatures.

Deterministic tests use a fake implementation of the treasury port and cover
1-of-1, 2-of-3, 3-of-4, and 3-of-5 thresholds, every 2-of-4 signer combination,
outsiders, duplicate approvals, ERC-20 calldata, invalid inputs, exact balance
deltas, audit events, and double execution. The separate live test is gated by
`RUN_LIVE_M3=true` and reads all addresses, owner keys, token metadata, amount,
RPC, and chain ID from environment configuration.

The small-funds Milestone 3 live test passed on Base Sepolia with a budget of
1,000 atomic USDC units (0.001 USDC). Alice and Bob supplied the two distinct
owner signatures required by the deployed 2-of-3 Safe. The outsider submitted
the fully authorized transaction and paid gas, without contributing an approval.

The Safe initially held no USDC and the Agent Wallet held no ETH. Test setup used
the existing Coinbase CDP hosted x402 path to transfer 0.001 USDC from the Agent
Wallet to the Safe. This was only test funding; it did not replace the Safe
transaction used for budget issuance.

| Live action | Transaction |
| --- | --- |
| Initial setup funding through hosted x402 | `0xce7208cacca521d1cf4eb04544d2cdfb589b46c3d849c4ebcf7dae86a5b95b20` |
| Initial Safe execution that exposed RPC read lag | `0xc6e663368e1d620a75637b443a68853f2de6fa76d27d9df837cb06b98455d37c` |
| Final setup funding through hosted x402 | `0xfc71489e4b0f9c6bafcf416298969f8f4159527adfc1cc15e81f76e2fd93d73c` |
| Verified Safe budget execution | `0xff6ba98418ecb477de9ddf7ddb07dea401fcd9ef19e4fc412c529cb97e0c97da` |

The final Safe transaction hash was
`0x14a7b03b8e75b6f35cf48f327a9d14432a5aafba8077a6f39e7e7a971d32f4ab`.
The observed Safe balance changed from 1,000 to 0 atomic units, and the Agent
Wallet balance changed from 19,599,000 to 19,600,000. A second execution request
returned the same execution hash, and both balances remained unchanged.

An earlier live execution successfully moved the same amount, but the first
verification attempt read stale post-receipt balances from the public RPC. The
adapter now performs bounded uncached polling for the exact expected deltas. The
corrected live run then passed all threshold, receipt, balance, and replay checks.

Milestone 3 non-fund-consuming verification passed:

```text
npm run build
npm test                         # 4 files, 39 tests
npm ls --depth=0
git diff --check
Milestone 3 live suite          # 1 small-funds live test passed
```

### Milestone 3 → Milestone 2 smoke test

The separate opt-in smoke test was enabled and passed on Base Sepolia. The Safe
received 0.002 USDC of test funding, issued that full amount to the Agent Wallet
after Alice and Bob supplied the required two approvals, and the Agent Wallet
then paid the 0.001 USDC requirement returned by the existing premium endpoint
through Coinbase CDP's hosted facilitator.

| Live action | Transaction |
| --- | --- |
| Smoke-test Safe funding through hosted x402 | `0x71f520741bbc9e3195c46994deff71db9b38899bb11cc222d639a48e26021253` |
| Safe budget execution | `0x30b026b0c6cf39aa87246cda29ebd5a0309787747dd0cbfdaeccc300a34750ec` |
| Hosted x402 payment | `0x9807dc105189d7af7c8b833674a3ff776f71dda509579b6fe742101983bb12c2` |

The Safe transaction hash was
`0x1036651ad5ce05ca42cc8ed8b0a8342dabf55cb53d27055e2da49b2758ac413d`.
Observed atomic-USDC balances were:

- Safe: 2,000 → 0
- Agent Wallet: 19,598,000 → 19,600,000 after budget → 19,599,000 after payment
- Merchant: 500,000 → 501,000

All smoke assertions passed: the initial response required payment, the payment
was within the available budget, both Safe-to-Agent and Agent-to-merchant deltas
were exact, the hosted settlement receipt succeeded, and the Agent Wallet kept
the expected 0.001 USDC remainder. Evidence is written to the ignored
`milestone3-x402-result.json` file.

## Milestone 4 — Protected economic rights

Milestone 4 adds a completely separate economic-ownership path over the official
Splits protocol. It does not change the Safe treasury, operating-budget, Agent
Wallet, x402, or hosted-facilitator paths from Milestones 1–3.

The selected implementation is Splits V2.2 PushSplit. PushSplit was selected
because the configured recipient set is small and the protocol transfers ERC-20
balances directly to recipients, making balance-delta evidence straightforward.
`@0xsplits/splits-sdk@6.6.0` is pinned. The adapter uses the package's official
V2.2 factory address, factory ABI, Split ABI, supported-chain list, recipient
limit, and proxy-bytecode classifier. It invokes those official contracts with
viem so Pact's integer basis points can be passed directly; the higher-level SDK
creation helper represents percentages as JavaScript numbers and would introduce
floating-point values at the protocol boundary.

`RevenueSplit`, `RevenueShare`, and `RevenueDistributionResult` are Pact domain
types. `RevenueSplitService` validates application invariants and emits normalized
`REVENUE_SPLIT_CREATED`, `REVENUE_RECEIVED`, and `REVENUE_DISTRIBUTED` events.
`RevenueSplitAdapter` keeps every Splits-specific object behind a narrow port, and
`SplitsV2PushSplitAdapter` implements that port.

Pact requires all allocations to be positive integer basis points totaling
exactly 10,000, even though Splits V2 permits arbitrary allocation totals. Empty,
malformed, zero, duplicate, fractional, negative, over-10,000, non-totaling, and
mutable inputs are rejected. Recipients are normalized and sorted before the
official factory call.

The split is immutable from inception: both owner and creator are set to the zero
address. Read-back verification identifies the official PushSplit implementation
from clone bytecode, confirms the V2.2 EIP-712 domain, reads `owner()` and
`splitHash()`, loads the exact `SplitUpdated` event at `updateBlockNumber`, and
recomputes the Solidity struct hash. A split is accepted only when the owner is
zero and the stored hash matches the authoritative event configuration. With no
owner, `updateSplit`, `setPaused`, ownership transfer, and owner-authorized call
execution cannot be initiated by the deployer, Safe, Agent Wallet, or another
account.

Rounding follows the audited protocol implementation rather than a Pact-defined
rule. Full-balance PushSplit distribution reserves one atomic unit from each
non-empty Split/Warehouse balance; each recipient allocation then uses Solidity
floor division independently, leaving any additional division dust in the split.
The live test derives the smallest positive funding amount whose distributable
portion has zero rounding dust. It reuses `OUTSIDER_PRIVATE_KEY` as the gas-paying
deployer/funder and the existing generic token/network configuration, so M4 does
not introduce duplicate token, decimal, private-key, or amount variables.

Deterministic verification after implementation:

```text
npm run build                    # passed
npm test                         # 5 files, 62 tests passed
```

The M4 live suite is gated by `RUN_LIVE_M4=true`. It passed on Base Sepolia with
the existing outsider test wallet acting only as gas-paying deployer, funder, and
permissionless distributor. The resulting immutable PushSplit is:

| Item | Value |
| --- | --- |
| PushSplit | `0x744052918Ad03470723Ac942f0c8381c50A99489` |
| Creation transaction | `0xf0ce85b67aaf206d8661f07037e2ea5ccf0659f38d6cb5880763d661d4fa6744` |
| Funding transaction | `0x47e6a931d5f0f3cbf400119e4aada0cb062c79ab907241450f8412ad389faa0f` |
| Distribution transaction | `0xc1dcd6cdfe27f6b38a1f1f86d84beac47600d15391518dfc4a0616235487f735` |
| Token | Base Sepolia USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Funding | 21 atomic units |
| Distributed | 20 atomic units |
| Protocol reserve | 1 atomic unit |

The configured ownership and observed atomic-USDC deltas were:

| Recipient | Allocation | Delta |
| --- | ---: | ---: |
| `0x4D4b99E08556ba008F8d59148a295a07855Be9B8` | 4,000 bps | 8 |
| `0x601b9AB41DEB8eA6DbC250d2613b102A4297b8d1` | 3,500 bps | 7 |
| `0xAdC1B42536F3EAD7a16D70de99DD2db54d768f8A` | 2,500 bps | 5 |

Authoritative verification identified the official V2.2 PushSplit bytecode,
confirmed `owner()` is the zero address, loaded the current `SplitUpdated` event
at `updateBlockNumber`, and independently recomputed a matching `splitHash()`.
The Agent Wallet, Safe, and deployer each received zero and held no control.

Evidence for the successful run is stored in the ignored
`milestone4-result.json`; `RUN_LIVE_M4` was returned to `false` afterward to
prevent accidental repeat spending.
