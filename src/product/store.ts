import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const PACT_ID = 'pact-hack-seoul';
const SAFE_ADDRESS = '0x7990aa16cFa09E9d5d619c10378320d1895eb3Ae';
const AGENT_WALLET = '0x0e1cBC140a9356F32Feb7eB645C595b4C19E9e2F';
const SPLIT_ADDRESS = '0x744052918Ad03470723Ac942f0c8381c50A99489';
const BUDGET_PROOF_TX = '0xff6ba98418ecb477de9ddf7ddb07dea401fcd9ef19e4fc412c529cb97e0c97da';
const PAYMENT_TX = '0xec83e8a2448b6f7264c8f1688a25549566663ade7cd322634b29ba74d5233b89';
const RESOURCE_PRICE = 100_000;

const MEMBER_SEED = [
  ['member-alice', 'Alice', '0x4D4b99E08556ba008F8d59148a295a07855Be9B8', 4000],
  ['member-bob', 'Bob', '0x601b9AB41DEB8eA6DbC250d2613b102A4297b8d1', 3500],
  ['member-carol', 'Carol', '0xAdC1B42536F3EAD7a16D70de99DD2db54d768f8A', 2500],
] as const;

export type ProductAction =
  | 'save-pact'
  | 'verify-member'
  | 'accept-pact'
  | 'activate-pact'
  | 'fund-treasury'
  | 'create-budget'
  | 'approve-budget'
  | 'issue-budget'
  | 'run-agent'
  | 'set-low-balance';

type Input = Record<string, unknown>;

export class ProductStore {
  private readonly db: DatabaseSync;

  constructor(filename = resolve(process.cwd(), '.pact', 'product-state.sqlite')) {
    mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    this.migrate();
    if (!this.db.prepare('SELECT id FROM pacts LIMIT 1').get()) this.reset();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pacts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        purpose TEXT NOT NULL,
        network TEXT NOT NULL,
        status TEXT NOT NULL,
        threshold INTEGER NOT NULL,
        treasury_address TEXT,
        treasury_balance_atomic INTEGER NOT NULL DEFAULT 0,
        agent_wallet_address TEXT NOT NULL,
        agent_balance_atomic INTEGER NOT NULL DEFAULT 0,
        split_address TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY,
        pact_id TEXT NOT NULL REFERENCES pacts(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        wallet_address TEXT NOT NULL,
        verified INTEGER NOT NULL DEFAULT 0,
        verification_method TEXT,
        founding_accepted INTEGER NOT NULL DEFAULT 0,
        allocation_bps INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS revenue_splits (
        id TEXT PRIMARY KEY,
        pact_id TEXT NOT NULL REFERENCES pacts(id) ON DELETE CASCADE,
        address TEXT NOT NULL,
        owner TEXT NOT NULL,
        immutable INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS budget_proposals (
        id TEXT PRIMARY KEY,
        pact_id TEXT NOT NULL REFERENCES pacts(id) ON DELETE CASCADE,
        amount_atomic INTEGER NOT NULL,
        purpose TEXT NOT NULL,
        status TEXT NOT NULL,
        execution_tx_hash TEXT,
        created_at TEXT NOT NULL,
        executed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS budget_approvals (
        id TEXT PRIMARY KEY,
        budget_id TEXT NOT NULL REFERENCES budget_proposals(id) ON DELETE CASCADE,
        member_id TEXT NOT NULL REFERENCES members(id),
        created_at TEXT NOT NULL,
        UNIQUE(budget_id, member_id)
      );
      CREATE TABLE IF NOT EXISTS agent_sessions (
        id TEXT PRIMARY KEY,
        pact_id TEXT NOT NULL REFERENCES pacts(id) ON DELETE CASCADE,
        budget_id TEXT REFERENCES budget_proposals(id),
        requested_by TEXT NOT NULL,
        task TEXT NOT NULL,
        status TEXT NOT NULL,
        answer TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS tool_executions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        tool_name TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS payment_records (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
        resource_name TEXT NOT NULL,
        amount_atomic INTEGER NOT NULL,
        status TEXT NOT NULL,
        tx_hash TEXT,
        http_status INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        pact_id TEXT NOT NULL REFERENCES pacts(id) ON DELETE CASCADE,
        actor TEXT NOT NULL,
        event_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_budget_pact_created ON budget_proposals(pact_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_session_pact_created ON agent_sessions(pact_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_pact_created ON audit_events(pact_id, created_at DESC);
    `);
  }

  reset() {
    const now = new Date().toISOString();
    this.transaction(() => {
      for (const table of ['audit_events', 'payment_records', 'tool_executions', 'agent_sessions', 'budget_approvals', 'budget_proposals', 'revenue_splits', 'members', 'pacts']) {
        this.db.exec(`DELETE FROM ${table}`);
      }
      this.db.prepare(`INSERT INTO pacts
        (id,name,purpose,network,status,threshold,agent_wallet_address,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
        PACT_ID, 'Hack Seoul Team', 'Hackathon project treasury', 'Base Sepolia', 'draft', 2,
        AGENT_WALLET, now, now,
      );
      const insertMember = this.db.prepare(`INSERT INTO members
        (id,pact_id,name,wallet_address,verified,founding_accepted,allocation_bps)
        VALUES (?,?,?,?,0,0,?)`);
      for (const [id, name, address, allocation] of MEMBER_SEED) {
        insertMember.run(id, PACT_ID, name, address, allocation);
      }
      this.audit('system', 'PACT_DRAFT_CREATED', 'Draft Pact created. No financial infrastructure exists yet.', { mode: 'product-sandbox' });
    });
    return this.getState();
  }

  getState() {
    const pact = this.row('SELECT * FROM pacts WHERE id = ?', PACT_ID);
    const members = this.rows('SELECT * FROM members WHERE pact_id = ? ORDER BY rowid', PACT_ID);
    const split = this.maybeRow('SELECT * FROM revenue_splits WHERE pact_id = ?', PACT_ID);
    const budgets = this.rows('SELECT * FROM budget_proposals WHERE pact_id = ? ORDER BY created_at DESC', PACT_ID).map((budget) => ({
      ...budget,
      approvals: this.rows(`SELECT ba.*, m.name, m.wallet_address FROM budget_approvals ba
        JOIN members m ON m.id = ba.member_id WHERE ba.budget_id = ? ORDER BY ba.created_at`, String(budget.id)),
    }));
    const sessions = this.rows('SELECT * FROM agent_sessions WHERE pact_id = ? ORDER BY created_at DESC', PACT_ID).map((session) => ({
      ...session,
      tools: this.rows('SELECT * FROM tool_executions WHERE session_id = ? ORDER BY sequence', String(session.id)),
      payment: this.maybeRow('SELECT * FROM payment_records WHERE session_id = ?', String(session.id)),
    }));
    const audit = this.rows('SELECT * FROM audit_events WHERE pact_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100', PACT_ID).map((event) => ({
      ...event,
      metadata: JSON.parse(String(event.metadata_json || '{}')) as unknown,
    }));
    return {
      mode: 'product-sandbox',
      authorityNotice: 'Product actions update normalized demo state. Safe, Agent Wallet, hosted x402 settlement, and immutable Split remain the financial authorities.',
      evidence: {
        safeAddress: SAFE_ADDRESS,
        splitAddress: SPLIT_ADDRESS,
        budgetProofTx: BUDGET_PROOF_TX,
        paymentTx: PAYMENT_TX,
        budgetProofAmount: '0.001 USDC',
      },
      pact,
      members,
      split,
      budgets,
      currentBudget: budgets[0] ?? null,
      sessions,
      currentSession: sessions[0] ?? null,
      audit,
    };
  }

  act(action: ProductAction, input: Input) {
    return this.transaction(() => {
      switch (action) {
        case 'save-pact': return this.savePact(input);
        case 'verify-member': return this.verifyMember(input);
        case 'accept-pact': return this.acceptPact(input);
        case 'activate-pact': return this.activatePact();
        case 'fund-treasury': return this.fundTreasury(input);
        case 'create-budget': return this.createBudget(input);
        case 'approve-budget': return this.approveBudget(input);
        case 'issue-budget': return this.issueBudget(input);
        case 'run-agent': return this.runAgent(input);
        case 'set-low-balance': return this.setLowBalance();
      }
    });
  }

  private savePact(input: Input) {
    const pact = this.row('SELECT status FROM pacts WHERE id = ?', PACT_ID);
    if (pact.status !== 'draft') throw new Error('Pact rules are locked after activation.');
    const name = this.text(input.name, 'Team name', 2, 80);
    const purpose = this.text(input.purpose, 'Purpose', 2, 160);
    const threshold = this.integer(input.threshold, 'Required approvals', 2, 3);
    const allocations = input.allocations;
    if (!allocations || typeof allocations !== 'object') throw new Error('Revenue allocations are required.');
    let total = 0;
    for (const [id] of MEMBER_SEED) {
      const value = this.integer((allocations as Input)[id], 'Revenue allocation', 0, 10_000);
      total += value;
      this.db.prepare('UPDATE members SET allocation_bps = ? WHERE id = ?').run(value, id);
    }
    if (total !== 10_000) throw new Error('Revenue ownership must total exactly 100%.');
    this.db.prepare('UPDATE pacts SET name=?, purpose=?, threshold=?, updated_at=? WHERE id=?')
      .run(name, purpose, threshold, new Date().toISOString(), PACT_ID);
    this.audit('Alice', 'PACT_RULES_SAVED', 'Team rules and economic ownership were saved for founding review.', { threshold, totalAllocationBps: total });
  }

  private verifyMember(input: Input) {
    const memberId = this.memberId(input.memberId);
    const method = input.method === 'wallet' ? 'wallet-signature' : 'seeded-demo-identity';
    const supplied = typeof input.walletAddress === 'string' ? input.walletAddress : null;
    if (method === 'wallet-signature' && !supplied) throw new Error('A connected wallet address is required.');
    if (supplied) this.db.prepare('UPDATE members SET wallet_address=? WHERE id=?').run(supplied, memberId);
    this.db.prepare('UPDATE members SET verified=1, verification_method=? WHERE id=?').run(method, memberId);
    const member = this.row('SELECT name FROM members WHERE id=?', memberId);
    this.audit(String(member.name), 'MEMBER_VERIFIED', `${member.name} verified wallet control.`, { method });
  }

  private acceptPact(input: Input) {
    const memberId = this.memberId(input.memberId);
    const member = this.row('SELECT name, verified FROM members WHERE id=?', memberId);
    if (!member.verified) throw new Error(`${member.name} must verify a wallet before accepting.`);
    this.db.prepare('UPDATE members SET founding_accepted=1 WHERE id=?').run(memberId);
    this.audit(String(member.name), 'PACT_ACCEPTED', `${member.name} accepted the founding Pact.`, {});
  }

  private activatePact() {
    const members = this.rows('SELECT verified, founding_accepted, allocation_bps FROM members WHERE pact_id=?', PACT_ID);
    if (members.some((member) => !member.verified || !member.founding_accepted)) throw new Error('All founding members must verify and accept first.');
    const total = members.reduce((sum, member) => sum + Number(member.allocation_bps), 0);
    if (total !== 10_000) throw new Error('Revenue ownership must total exactly 100%.');
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE pacts SET status='active', treasury_address=?, split_address=?, updated_at=? WHERE id=?`)
      .run(SAFE_ADDRESS, SPLIT_ADDRESS, now, PACT_ID);
    this.db.prepare(`INSERT OR REPLACE INTO revenue_splits (id,pact_id,address,owner,immutable,created_at) VALUES (?,?,?,?,1,?)`)
      .run('split-hack-seoul', PACT_ID, SPLIT_ADDRESS, '0x0000000000000000000000000000000000000000', now);
    this.audit('system', 'PACT_ACTIVATED', 'Shared treasury control and immutable revenue ownership are ready.', { safeAddress: SAFE_ADDRESS, splitAddress: SPLIT_ADDRESS, evidenceMode: true });
  }

  private fundTreasury(input: Input) {
    this.requireActive();
    const amountAtomic = this.integer(input.amountAtomic, 'Funding amount', 1, 1_000_000_000_000);
    this.db.prepare('UPDATE pacts SET treasury_balance_atomic=treasury_balance_atomic+?, updated_at=? WHERE id=?')
      .run(amountAtomic, new Date().toISOString(), PACT_ID);
    this.audit('Alice', 'TREASURY_FUNDED', 'Team treasury received sandbox scenario funds.', { amountAtomic, evidenceMode: true });
  }

  private createBudget(input: Input) {
    this.requireActive();
    const open = this.maybeRow(`SELECT id FROM budget_proposals WHERE pact_id=? AND status IN ('pending','approved') LIMIT 1`, PACT_ID);
    if (open) throw new Error('Finish the current budget proposal before creating another.');
    const amountAtomic = this.integer(input.amountAtomic, 'Budget amount', 1, 1_000_000_000_000);
    const purpose = this.text(input.purpose, 'Budget purpose', 2, 160);
    const pact = this.row('SELECT treasury_balance_atomic FROM pacts WHERE id=?', PACT_ID);
    if (amountAtomic > Number(pact.treasury_balance_atomic)) throw new Error('The proposed budget exceeds the team treasury.');
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO budget_proposals (id,pact_id,amount_atomic,purpose,status,created_at) VALUES (?,?,?,?,?,?)`)
      .run(id, PACT_ID, amountAtomic, purpose, 'pending', now);
    this.db.prepare(`INSERT INTO budget_approvals (id,budget_id,member_id,created_at) VALUES (?,?,?,?)`)
      .run(randomUUID(), id, 'member-alice', now);
    this.audit('Alice', 'BUDGET_PROPOSED', 'Alice proposed a bounded AI operating budget and approved it.', { budgetId: id, amountAtomic, purpose });
  }

  private approveBudget(input: Input) {
    const budgetId = this.text(input.budgetId, 'Budget', 1, 80);
    const memberId = this.memberId(input.memberId);
    const budget = this.row('SELECT status FROM budget_proposals WHERE id=?', budgetId);
    if (budget.status !== 'pending') throw new Error('This proposal is not awaiting approvals.');
    const member = this.row('SELECT name, verified FROM members WHERE id=?', memberId);
    if (!member.verified) throw new Error(`${member.name} must verify before approving.`);
    this.db.prepare(`INSERT OR IGNORE INTO budget_approvals (id,budget_id,member_id,created_at) VALUES (?,?,?,?)`)
      .run(randomUUID(), budgetId, memberId, new Date().toISOString());
    const approvals = Number(this.row('SELECT COUNT(*) AS count FROM budget_approvals WHERE budget_id=?', budgetId).count);
    const threshold = Number(this.row('SELECT threshold FROM pacts WHERE id=?', PACT_ID).threshold);
    if (approvals >= threshold) this.db.prepare(`UPDATE budget_proposals SET status='approved' WHERE id=?`).run(budgetId);
    this.audit(String(member.name), 'BUDGET_APPROVED', `${member.name} approved the AI operating budget.`, { budgetId, approvals, threshold });
  }

  private issueBudget(input: Input) {
    const budgetId = this.text(input.budgetId, 'Budget', 1, 80);
    const budget = this.row('SELECT * FROM budget_proposals WHERE id=?', budgetId);
    if (budget.status !== 'approved') throw new Error('The approval rule has not been reached.');
    const amount = Number(budget.amount_atomic);
    const pact = this.row('SELECT treasury_balance_atomic FROM pacts WHERE id=?', PACT_ID);
    if (amount > Number(pact.treasury_balance_atomic)) throw new Error('Treasury balance is insufficient.');
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE pacts SET treasury_balance_atomic=treasury_balance_atomic-?, agent_balance_atomic=agent_balance_atomic+?, updated_at=? WHERE id=?`)
      .run(amount, amount, now, PACT_ID);
    this.db.prepare(`UPDATE budget_proposals SET status='issued', execution_tx_hash=?, executed_at=? WHERE id=?`)
      .run(BUDGET_PROOF_TX, now, budgetId);
    this.audit('system', 'BUDGET_ISSUED', 'The approved operating budget moved into the Agent Wallet boundary.', { budgetId, amountAtomic: amount, proofTx: BUDGET_PROOF_TX, proofAmount: '0.001 USDC', evidenceMode: true });
  }

  private runAgent(input: Input) {
    this.requireActive();
    const task = this.text(input.task, 'Task', 8, 500);
    const pact = this.row('SELECT agent_balance_atomic FROM pacts WHERE id=?', PACT_ID);
    const budget = this.maybeRow(`SELECT id FROM budget_proposals WHERE pact_id=? AND status='issued' ORDER BY executed_at DESC LIMIT 1`, PACT_ID);
    if (!budget) throw new Error('Issue an operating budget before running Qwen.');
    const sessionId = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO agent_sessions (id,pact_id,budget_id,requested_by,task,status,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(sessionId, PACT_ID, String(budget.id), 'Alice', task, 'running', now);
    this.audit('Alice', 'AGENT_TASK_STARTED', 'Alice assigned a task to Qwen.', { sessionId, task });
    this.tool(sessionId, 1, 'inspectPaidResource', 'succeeded', 'Premium Market Brief requires 0.10 USDC. No payment was made during inspection.');
    this.tool(sessionId, 2, 'getOperatingBudget', 'succeeded', `Agent Wallet has ${(Number(pact.agent_balance_atomic) / 1_000_000).toFixed(2)} USDC available.`);
    if (Number(pact.agent_balance_atomic) < RESOURCE_PRICE) {
      const answer = `I found the required Premium Market Brief, but it costs 0.10 USDC and only ${(Number(pact.agent_balance_atomic) / 1_000_000).toFixed(2)} USDC remains. I cannot move additional money from the team treasury.`;
      this.tool(sessionId, 3, 'paidFetch', 'blocked', 'Payment was blocked before signing because the operating balance was insufficient.');
      this.db.prepare(`INSERT INTO payment_records (id,session_id,resource_name,amount_atomic,status,created_at) VALUES (?,?,?,?,?,?)`)
        .run(randomUUID(), sessionId, 'Premium Market Brief', RESOURCE_PRICE, 'blocked_insufficient_balance', now);
      this.db.prepare(`UPDATE agent_sessions SET status='blocked', answer=?, completed_at=? WHERE id=?`).run(answer, now, sessionId);
      this.audit('system', 'PAYMENT_BLOCKED', 'The resource purchase was blocked by the Agent Wallet balance boundary.', { sessionId, requiredAtomic: RESOURCE_PRICE, availableAtomic: Number(pact.agent_balance_atomic) });
      return;
    }
    this.tool(sessionId, 3, 'paidFetch', 'succeeded', '0.10 USDC settled through the verified x402 path and the resource returned HTTP 200.');
    const answer = 'Seoul is the strongest launch market. It leads the purchased dataset in developer adoption and paid-agent readiness while keeping acquisition cost below the cohort median.';
    this.db.prepare('UPDATE pacts SET agent_balance_atomic=agent_balance_atomic-?, updated_at=? WHERE id=?')
      .run(RESOURCE_PRICE, now, PACT_ID);
    this.db.prepare(`INSERT INTO payment_records (id,session_id,resource_name,amount_atomic,status,tx_hash,http_status,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(randomUUID(), sessionId, 'Premium Market Brief', RESOURCE_PRICE, 'settled', PAYMENT_TX, 200, now);
    this.db.prepare(`UPDATE agent_sessions SET status='completed', answer=?, completed_at=? WHERE id=?`).run(answer, now, sessionId);
    this.audit('Qwen', 'PAYMENT_SETTLED', 'Qwen purchased the Premium Market Brief within its issued operating balance.', { sessionId, amountAtomic: RESOURCE_PRICE, txHash: PAYMENT_TX });
    this.audit('Qwen', 'AGENT_TASK_COMPLETED', 'Qwen completed the task using the purchased result.', { sessionId, primaryMarket: 'Seoul' });
  }

  private setLowBalance() {
    this.requireActive();
    this.db.prepare('UPDATE pacts SET agent_balance_atomic=30000, updated_at=? WHERE id=?').run(new Date().toISOString(), PACT_ID);
    this.audit('demo operator', 'BOUNDARY_TEST_PREPARED', 'The product sandbox set the Agent Wallet display balance to 0.03 USDC for an insufficient-budget test.', { evidenceMode: true });
  }

  private tool(sessionId: string, sequence: number, toolName: string, status: string, summary: string) {
    this.db.prepare(`INSERT INTO tool_executions (id,session_id,sequence,tool_name,status,summary,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(randomUUID(), sessionId, sequence, toolName, status, summary, new Date().toISOString());
  }

  private audit(actor: string, type: string, summary: string, metadata: unknown) {
    this.db.prepare(`INSERT INTO audit_events (id,pact_id,actor,event_type,summary,metadata_json,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(randomUUID(), PACT_ID, actor, type, summary, JSON.stringify(metadata), new Date().toISOString());
  }

  private requireActive() {
    if (this.row('SELECT status FROM pacts WHERE id=?', PACT_ID).status !== 'active') throw new Error('Activate the founding Pact first.');
  }

  private memberId(value: unknown) {
    const id = this.text(value, 'Member', 1, 80);
    if (!MEMBER_SEED.some(([memberId]) => memberId === id)) throw new Error('Unknown member.');
    return id;
  }

  private text(value: unknown, label: string, min: number, max: number) {
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new Error(`${label} is invalid.`);
    return value.trim();
  }

  private integer(value: unknown, label: string, min: number, max: number) {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${label} is invalid.`);
    return number;
  }

  private row(sql: string, ...params: Array<string | number>) {
    const result = this.maybeRow(sql, ...params);
    if (!result) throw new Error('Required product state was not found.');
    return result;
  }

  private maybeRow(sql: string, ...params: Array<string | number>) {
    return this.db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
  }

  private rows(sql: string, ...params: Array<string | number>) {
    return this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
