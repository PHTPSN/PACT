# Pact final demo runbook

## One story

```text
Alice, Bob, and Carol create a Pact
        ↓
2-of-3 Safe jointly controls the team treasury
        ↓
40/35/25 revenue ownership is fixed separately
        ↓
Alice and Bob approve a 2 USDC operating budget
        ↓
Qwen receives a launch-market task
        ↓
Qwen inspects a 0.1 USDC paid market brief
        ↓
Agent Wallet pays through standard x402
        ↓
Qwen selects Seoul from the purchased data
        ↓
Controls & Audit reconstructs who approved, what was bought,
and what moved onchain
```

## Presenter sequence

1. Open **Treasurer**. Establish the three money boundaries: team treasury,
   Agent operating balance, and immutable revenue ownership.
2. Point to the 2-of-3 Safe threshold and the separate 40/35/25 Split.
3. Show Alice and Bob's approvals for the 2 USDC Agent Wallet budget.
4. Walk through Qwen's tool trace: quote inspection, bounded `paidFetch`, and
   the useful market recommendation returned from the paid dataset.
5. Open the BaseScan links for the budget transfer and x402 settlement.
6. Switch to **Controls & Audit** and reconstruct the same story from the shared
   normalized state.
7. Show the remaining Agent Wallet exposure. Do not rerun live settlement unless
   new evidence is explicitly required.

## Known-good evidence

| Claim | Evidence |
| --- | --- |
| Joint treasury control | Safe `0x7990aa16cFa09E9d5d619c10378320d1895eb3Ae`, threshold 2-of-3 |
| Bounded capital issuance | Base Sepolia tx `0xff6ba98418ecb477de9ddf7ddb07dea401fcd9ef19e4fc412c529cb97e0c97da` |
| Immutable ownership | PushSplit `0x744052918Ad03470723Ac942f0c8381c50A99489`, owner `0x0000000000000000000000000000000000000000` |
| Real x402 payment | Base Sepolia tx `0xec83e8a2448b6f7264c8f1688a25549566663ade7cd322634b29ba74d5233b89` |

## What is real and what is recorded

**Real protocol evidence:** the Safe and its threshold, budget-transfer receipt,
Agent Wallet payment receipt, Coinbase CDP hosted-facilitator path, and immutable
Splits V2.2 ownership are independently verifiable on Base Sepolia.

**Recorded product state:** Pact metadata, member display names, approvals,
Qwen session/tool records, normalized payment metadata, and audit events are
stored for a stable demo. They are not used to authorize transactions or assert
financial balances.

## Reset and recovery

- Use **Reset scenario** in the product top bar.
- Reset never touches blockchain state and never performs a paid request.
- Before a live settlement rerun, verify the endpoint, configured network,
  Agent Wallet balance, payment cap, and hosted facilitator independently.
- If live infrastructure is unavailable, present the recorded transaction links
  and normalized audit history; do not substitute a local facilitator.

## Final verification

```bash
npm test
node --max-old-space-size=2048 node_modules/typescript/bin/tsc -p tsconfig.json
npm run product:start
```
