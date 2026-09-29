# Pact — Generic M-of-N Treasury and delegated x402 payments

This package implements a generic MetaMask MultiSig DeleGator treasury. Production
code accepts any non-empty unique owner set and any integer threshold from one to
the owner count. The canonical Alice/Bob/Carol 2-of-3 setup exists only in tests
and the demo script.

## Commands

```bash
npm install
npm run build
npm run test:unit
```

The unit suite validates configuration, counterfactual address equality, SDK
signature generation/aggregation for multiple M-of-N fixtures, duplicate-owner
rejection, outsider rejection, mixed-operation rejection, and signer-order
invariance. It does not claim that an in-memory signature count is onchain
authorization; actual threshold enforcement is covered by the Base Sepolia test.

## Base Sepolia proof

Copy `.env.example` to `.env` and set all values. The three owner keys must be
independent, and the derived treasury address must hold enough Base Sepolia ETH
to pay ERC-4337 prefund plus the demo's one-wei transfers. The bundler URL must
support Base Sepolia ERC-4337 EntryPoint v0.7.

Alternatively, generate testnet-only identities without overwriting any existing
keys. This also prints the deterministic treasury address that needs funding:

```bash
npm run setup:milestone1
```

```bash
npm run test:integration
npm run demo:milestone1
```

The integration test first attempts a one-owner operation and verifies that the
recipient balance does not change. It then submits a two-owner operation, waits
for its receipt, and verifies the one-wei balance change. The demo exercises all
three owner pairs, all three owners, the fourth identity's negative boundary,
duplicate signatures, and mixed-operation signatures. It writes
`milestone1-result.json`, including UserOperation and transaction hashes.

Private keys in `.env` are testnet-only secrets. Never reuse production keys.

## Milestone 2: ERC-7710 x402 payment

Milestone 2 adds a real delegated payment path on Base Sepolia:

```text
M-of-N Treasury
  -> periodic USDC root delegation
  -> AgentSession creates an exact-payment child delegation
  -> x402 facilitator verifies and settles through DelegationManager onchain
  -> the protected endpoint returns { "premiumData": "hello" }
```

The root authority uses the ERC20 period-transfer enforcer for a 1 USDC daily
limit and the timestamp enforcer for expiry. Each x402 child is narrowed to the
requested token amount, payee, short expiry, and MetaMask development facilitator.
The protected response is returned only when the x402 settlement header reports a
successful onchain settlement. `readDelegatedBudget` queries the enforcer's
onchain state; there is no backend budget counter.

The runnable Base Sepolia demo uses `LocalErc7710Facilitator`, with the existing
outsider test identity as the gas-paying redemption relay. This is a real
facilitator implementation: `verify` simulates `DelegationManager.redeemDelegations`
and `settle` submits that call and waits for its onchain receipt. The MultiSig
Treasury remains the USDC payer. The hosted MetaMask development facilitator
currently rejects a deployed MultiSig DeleGator with
`invalid_exact_evm_erc7710_account_not_delegated`, so using it would change the
required payer architecture to a Stateless7702 account.

Set a Base Sepolia merchant address in `MILESTONE2_PAY_TO_ADDRESS`, then create
the Alice+Bob-signed root authority. This writes a non-secret delegation artifact;
the owner private keys remain only in `.env`.

```bash
npm run setup:milestone2
```

Start the protected resource server in one terminal:

```bash
npm run server:milestone2
```

Run the AgentSession buyer in another terminal:

```bash
npm run demo:milestone2
```

The Treasury smart-account address—not AgentSession—must hold the Base Sepolia
USDC being spent. It also needs the network/bundler funding required by the
facilitator's delegated execution path. The local facilitator identity needs a
small Base Sepolia ETH balance for redemption gas. The demo price is 0.10 USDC; the root
period allowance is 1.00 USDC. `buildDelegationRevocationCall` returns a normal
Treasury call that can be submitted through the existing M-of-N execution path.

For negative-boundary checks, `MILESTONE2_PRICE_ATOMIC` changes the server price
and `MILESTONE2_CLIENT_MAX_ATOMIC` changes only the client's local ceiling. A
2 USDC request (`2000000`) with a matching client ceiling reaches real contract
simulation and is rejected by the 1 USDC/day delegation without moving funds.
