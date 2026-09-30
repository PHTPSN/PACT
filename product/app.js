let state;
let view = 'setup';

const app = document.querySelector('#app');
const title = document.querySelector('#page-title');
const status = document.querySelector('#pact-status');
const notice = document.querySelector('#authority-notice');
const toast = document.querySelector('#toast');

const money = (atomic) => `${(Number(atomic || 0) / 1_000_000).toFixed(2)} USDC`;
const percent = (bps) => `${(Number(bps) / 100).toFixed(Number(bps) % 100 ? 2 : 0)}%`;
const short = (value, start = 8, end = 5) => value ? `${value.slice(0, start)}…${value.slice(-end)}` : '—';
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const formatTime = (value) => new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));

async function request(path, options) {
  const response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'The action could not be completed.');
  state = body;
  render();
  return body;
}

async function load() {
  try { await request('/api/state'); }
  catch (error) { showToast(error.message, true); app.innerHTML = `<div class="empty">Product state could not be loaded.</div>`; }
}

async function act(name, body = {}) {
  try {
    await request(`/api/actions/${name}`, { method: 'POST', body: JSON.stringify(body) });
    showToast('Product state updated.');
  } catch (error) { showToast(error.message, true); }
}

function showToast(message, error = false) {
  toast.textContent = message;
  toast.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.className = 'toast'; }, 3200);
}

function render() {
  notice.textContent = state.authorityNotice;
  status.textContent = state.pact.status === 'active' ? 'Pact active' : 'Founding setup';
  status.className = `status-pill${state.pact.status === 'active' ? ' active' : ''}`;
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  const titles = { setup: state.pact.status === 'active' ? 'Team Pact' : 'Create your Pact', treasurer: 'AI Treasurer', audit: 'Controls & Audit' };
  title.textContent = titles[view];
  app.innerHTML = view === 'setup' ? renderSetup() : view === 'treasurer' ? renderTreasurer() : renderAudit();
}

function renderSetup() {
  const allVerified = state.members.every(member => member.verified);
  const allAccepted = state.members.every(member => member.founding_accepted);
  const total = state.members.reduce((sum, member) => sum + Number(member.allocation_bps), 0);
  const draft = state.pact.status === 'draft';
  return `<div class="workspace-grid">
    <div class="stack">
      <section class="card">
        <div class="card-head"><div><p class="eyebrow">TEAM ACCOUNT</p><h2>Who is building together?</h2><p>Names and wallet addresses keep protocol details out of the way.</p></div><span class="section-number">01</span></div>
        <div class="form-grid">
          <label>Team name<input id="team-name" value="${escapeHtml(state.pact.name)}" ${draft ? '' : 'disabled'}></label>
          <label>Purpose<input id="team-purpose" value="${escapeHtml(state.pact.purpose)}" ${draft ? '' : 'disabled'}></label>
        </div>
        <div class="member-list" style="margin-top:16px">${state.members.map(member => memberCard(member, draft)).join('')}</div>
      </section>

      <section class="card">
        <div class="card-head"><div><p class="eyebrow">SHARED RULES</p><h2>Control and ownership are separate</h2><p>Routine treasury decisions need ${state.pact.threshold} people. Revenue ownership locks when the Pact is activated.</p></div><span class="section-number">02</span></div>
        <div class="form-grid">
          <label class="full">How many members must approve treasury actions?
            <select id="threshold" ${draft ? '' : 'disabled'}><option value="2" ${Number(state.pact.threshold) === 2 ? 'selected' : ''}>Any 2 of 3 members must agree</option><option value="3" ${Number(state.pact.threshold) === 3 ? 'selected' : ''}>All 3 members must agree</option></select>
          </label>
        </div>
        <div style="margin-top:18px"><h3>Who owns future shared revenue?</h3>${state.members.map(member => `<label class="allocation-row"><span>${member.name}</span><input class="allocation" data-member-id="${member.id}" type="number" min="0" max="100" step="1" value="${Number(member.allocation_bps) / 100}" ${draft ? '' : 'disabled'}></label>`).join('')}<div class="total"><span>Total ownership</span><strong class="${total === 10000 ? 'valid' : ''}">${percent(total)}</strong></div></div>
        ${draft ? `<div class="button-row"><button class="button secondary" data-action="save-pact">Save rules</button></div>` : ''}
      </section>

      ${draft ? `<section class="card">
        <div class="card-head"><div><p class="eyebrow">FOUNDING REVIEW</p><h2>Everyone accepts before activation</h2><p>Joining the team is different from approving routine treasury actions.</p></div><span class="section-number">03</span></div>
        <div class="member-list">${state.members.map(member => acceptanceCard(member)).join('')}</div>
        <div class="button-row"><button class="button" data-action="activate-pact" ${allVerified && allAccepted && total === 10000 ? '' : 'disabled'}>Create team Pact</button></div>
      </section>` : activatedCard()}
    </div>
    <aside class="stack">
      <section class="card"><div class="card-head"><div><p class="eyebrow">THE THREE BOUNDARIES</p><h2>What Pact protects</h2></div></div><div class="concepts"><div class="concept"><strong>TEAM TREASURY</strong><span>Shared money. Humans control it together.</span></div><div class="concept"><strong>AI OPERATING BALANCE</strong><span>Limited autonomous money. Qwen can spend it.</span></div><div class="concept"><strong>REVENUE OWNERSHIP</strong><span>Who ultimately owns shared income. AI cannot change it.</span></div></div><div class="lock-note">Approval power is not ownership. Two members can approve a treasury action, but they cannot rewrite Carol’s 25%.</div></section>
      <section class="card"><div class="card-head"><div><p class="eyebrow">PROGRESS</p><h2>Founding checklist</h2></div></div><div class="approval-list"><div class="approval"><span>Wallets verified</span><span class="approval-state ${allVerified ? 'yes' : ''}">${state.members.filter(m => m.verified).length} / 3</span></div><div class="approval"><span>Founders accepted</span><span class="approval-state ${allAccepted ? 'yes' : ''}">${state.members.filter(m => m.founding_accepted).length} / 3</span></div><div class="approval"><span>Ownership totals 100%</span><span class="approval-state ${total === 10000 ? 'yes' : ''}">${percent(total)}</span></div></div></section>
    </aside>
  </div>`;
}

function memberCard(member, draft) {
  return `<div class="member"><div class="member-main"><span class="avatar">${member.name[0]}</span><div><strong>${member.name}${member.name === 'Alice' ? ' · You' : ''}</strong><code>${short(member.wallet_address)}</code></div></div><div class="member-actions">${member.verified ? `<span class="chip success">✓ Wallet verified</span>` : draft ? `<button class="button ghost mini" data-action="connect-wallet" data-member-id="${member.id}">Connect wallet</button><button class="button secondary mini" data-action="verify-demo" data-member-id="${member.id}">Use demo identity</button>` : `<span class="chip pending">Pending</span>`}</div></div>`;
}

function acceptanceCard(member) {
  return `<div class="member"><div class="member-main"><span class="avatar">${member.name[0]}</span><div><strong>${member.name}</strong><code>${member.verified ? 'Identity verified' : 'Verify wallet first'}</code></div></div><div class="member-actions">${member.founding_accepted ? `<span class="chip success">✓ Pact accepted</span>` : `<button class="button secondary mini" data-action="accept-pact" data-member-id="${member.id}" ${member.verified ? '' : 'disabled'}>Accept Pact</button>`}</div></div>`;
}

function activatedCard() {
  return `<section class="card"><div class="card-head"><div><p class="eyebrow">TEAM ACCOUNT READY</p><h2>Shared infrastructure attached</h2><p>The product uses the verified Base Sepolia Safe and immutable PushSplit evidence.</p></div><span class="chip success">✓ Active</span></div><div class="evidence"><a href="https://sepolia.basescan.org/address/${state.evidence.safeAddress}" target="_blank" rel="noreferrer"><span>Protected treasury</span><code>${short(state.evidence.safeAddress,10,6)}</code></a><a href="https://sepolia.basescan.org/address/${state.evidence.splitAddress}" target="_blank" rel="noreferrer"><span>Immutable ownership</span><code>${short(state.evidence.splitAddress,10,6)}</code></a></div>${Number(state.pact.treasury_balance_atomic) === 0 ? `<div class="button-row"><button class="button" data-action="fund-treasury">Add 100 USDC scenario balance</button></div>` : `<div class="button-row"><button class="button" data-action="go-treasurer">Continue to AI budget</button></div>`}</section>`;
}

function renderTreasurer() {
  if (state.pact.status !== 'active') return gate('Finish the founding Pact first', 'All three members must verify and accept the shared rules before the AI can receive any money.');
  const budget = state.currentBudget;
  const session = state.currentSession;
  const treasury = Number(state.pact.treasury_balance_atomic);
  return `<div class="stack">
    <div class="metrics"><div class="metric"><span>Team treasury</span><strong>${money(treasury)}</strong><small>${state.pact.threshold}-of-3 human approval</small></div><div class="metric primary"><span>AI operating balance</span><strong>${money(state.pact.agent_balance_atomic)}</strong><small>Maximum autonomous exposure</small></div><div class="metric"><span>Revenue ownership</span><strong>40 / 35 / 25</strong><small>Immutable · AI has no control</small></div></div>
    ${treasury === 0 ? `<section class="card"><div class="card-head"><div><p class="eyebrow">FUND THE TEAM</p><h2>The AI still has zero access</h2><p>Add a scenario balance to the protected team treasury before proposing an AI budget.</p></div></div><button class="button" data-action="fund-treasury">Add 100 USDC scenario balance</button></section>` : renderBudget(budget)}
    ${budget?.status === 'issued' ? renderAgent(session) : ''}
  </div>`;
}

function renderBudget(budget) {
  if (!budget || budget.status === 'issued' && Number(state.pact.agent_balance_atomic) === 0) return `<section class="card"><div class="card-head"><div><p class="eyebrow">ISSUE OPERATING CAPITAL</p><h2>How much may Qwen operate with?</h2><p>This proposal moves only an explicitly approved amount out of the shared treasury boundary.</p></div></div><div class="form-grid"><label>Amount<input id="budget-amount" type="number" value="2" min="0.1" step="0.1"><span class="muted">USDC</span></label><label>Purpose<input id="budget-purpose" value="Paid APIs and market data"></label></div><div class="button-row"><button class="button" data-action="create-budget">Create budget proposal</button></div></section>`;
  if (budget.status === 'pending' || budget.status === 'approved') {
    const approved = new Set(budget.approvals.map(item => item.member_id));
    return `<section class="card"><div class="card-head"><div><p class="eyebrow">AI OPERATING BUDGET PROPOSAL</p><h2>${money(budget.amount_atomic)} for ${escapeHtml(budget.purpose)}</h2><p>The Agent Wallet is the recipient. It is not a treasury owner.</p></div><span class="chip ${budget.status === 'approved' ? 'success' : 'pending'}">${budget.approvals.length} / ${state.pact.threshold} approvals</span></div><div class="proposal"><div class="proposal-head"><div><strong>To Agent Wallet</strong><code>${short(state.pact.agent_wallet_address,10,6)}</code></div><strong>${money(budget.amount_atomic)}</strong></div><div class="proposal-body"><div class="approval-list">${state.members.map(member => `<div class="approval"><span>${member.name}</span>${approved.has(member.id) ? `<span class="approval-state yes">✓ Approved</span>` : `<button class="button secondary mini" data-action="approve-budget" data-member-id="${member.id}" data-budget-id="${budget.id}">Approve</button>`}</div>`).join('')}</div></div></div><div class="button-row">${budget.status === 'approved' ? `<button class="button" data-action="issue-budget" data-budget-id="${budget.id}">Issue approved budget</button>` : ''}</div></section>`;
  }
  return `<section class="card"><div class="card-head"><div><p class="eyebrow">OPERATING CAPITAL ACTIVE</p><h2>Qwen may spend up to ${money(state.pact.agent_balance_atomic)}</h2><p>It can spend only from the Agent Wallet—not from the protected team treasury.</p></div><span class="chip success">✓ Issued</span></div><p class="boundary-copy">Humans approved the boundary. Individual purchases inside that boundary do not need a new treasury vote.</p></section>`;
}

function renderAgent(session) {
  return `<div class="workspace-grid"><section class="card"><div class="card-head"><div><p class="eyebrow">ASSIGN A TASK</p><h2>Ask for an outcome, not a blockchain operation</h2><p>Qwen will inspect the paid resource and decide whether the purchase fits its operating balance.</p></div></div><div class="task-box"><textarea id="agent-task">Get the premium market brief and identify the strongest launch market for our team.</textarea><div class="button-row"><button class="button" data-action="run-agent">Run Qwen</button><button class="button ghost" data-action="low-balance">Test insufficient balance</button></div></div>${session ? sessionResult(session) : ''}</section><aside class="card"><div class="card-head"><div><p class="eyebrow">PURCHASE BOUNDARY</p><h2>Before Qwen spends</h2></div></div><div class="approval-list"><div class="approval"><span>Resource price</span><strong>0.10 USDC</strong></div><div class="approval"><span>Available balance</span><strong>${money(state.pact.agent_balance_atomic)}</strong></div><div class="approval"><span>Human reapproval</span><strong>Not required</strong></div><div class="approval"><span>Treasury access</span><strong>None</strong></div></div></aside></div>`;
}

function sessionResult(session) {
  return `<div style="margin-top:22px"><div class="card-head"><div><p class="eyebrow">LATEST RUN</p><h2>${session.status === 'completed' ? 'Task completed' : 'Operating boundary stopped the purchase'}</h2></div><span class="chip ${session.status === 'completed' ? 'success' : 'blocked'}">${session.status}</span></div><div class="activity">${session.tools.map(tool => `<div class="activity-item"><span class="activity-icon ${tool.status === 'blocked' ? 'blocked' : ''}">${tool.status === 'blocked' ? '!' : '✓'}</span><div><strong>${escapeHtml(tool.tool_name)}</strong><p>${escapeHtml(tool.summary)}</p></div></div>`).join('')}</div>${session.payment ? `<div class="receipt"><div><span>Resource</span><strong>${escapeHtml(session.payment.resource_name)}</strong></div><div><span>Paid</span><strong>${session.payment.status === 'settled' ? money(session.payment.amount_atomic) : 'Blocked'}</strong></div><div><span>Settlement</span><strong>${session.payment.tx_hash ? short(session.payment.tx_hash,10,6) : 'No transaction'}</strong></div></div>` : ''}<div class="answer"><strong>QWEN</strong><p>${escapeHtml(session.answer)}</p></div>${session.status === 'blocked' ? `<div class="button-row"><button class="button" data-action="new-budget">Propose additional AI budget</button></div>` : ''}</div>`;
}

function renderAudit() {
  const budget = state.currentBudget;
  const session = state.currentSession;
  return `<div class="workspace-grid"><div class="stack"><section class="card"><div class="card-head"><div><p class="eyebrow">CONTROL MAP</p><h2>Who can move what?</h2></div></div><div class="concepts"><div class="concept"><strong>TEAM TREASURY · ${money(state.pact.treasury_balance_atomic)}</strong><span>${state.pact.threshold}-of-3 members must agree. Safe ${short(state.pact.treasury_address || state.evidence.safeAddress)}</span></div><div class="concept"><strong>AI OPERATING BALANCE · ${money(state.pact.agent_balance_atomic)}</strong><span>Qwen may spend this balance. It cannot request or issue more.</span></div><div class="concept"><strong>REVENUE OWNERSHIP · IMMUTABLE</strong><span>${state.members.map(member => `${member.name} ${percent(member.allocation_bps)}`).join(' · ')}</span></div></div></section><section class="card"><div class="card-head"><div><p class="eyebrow">AUDIT TRAIL</p><h2>From human approval to machine purchase</h2><p>Normalized records reconstruct the story without becoming financial authority.</p></div></div><div class="timeline">${state.audit.map(event => `<div class="event"><time>${formatTime(event.created_at)}</time><div><strong>${escapeHtml(event.event_type.replaceAll('_',' '))} · ${escapeHtml(event.actor)}</strong><p>${escapeHtml(event.summary)}</p></div></div>`).join('')}</div></section></div><aside class="stack"><section class="card"><div class="card-head"><div><p class="eyebrow">CURRENT AUTHORITY</p><h2>Bounded by construction</h2></div></div><div class="approval-list"><div class="approval"><span>Founders</span><strong>3 verified</strong></div><div class="approval"><span>Treasury rule</span><strong>${state.pact.threshold} of 3</strong></div><div class="approval"><span>Budget issued</span><strong>${budget?.status === 'issued' ? money(budget.amount_atomic) : 'None'}</strong></div><div class="approval"><span>Latest purchase</span><strong>${session?.payment?.status === 'settled' ? money(session.payment.amount_atomic) : 'None'}</strong></div></div></section><section class="card"><div class="card-head"><div><p class="eyebrow">VERIFIABLE EVIDENCE</p><h2>Independent receipts</h2></div></div><div class="evidence"><a href="https://sepolia.basescan.org/tx/${state.evidence.budgetProofTx}" target="_blank" rel="noreferrer"><span>Live budget mechanism proof · ${state.evidence.budgetProofAmount}</span><code>${short(state.evidence.budgetProofTx,10,6)}</code></a><a href="https://sepolia.basescan.org/tx/${state.evidence.paymentTx}" target="_blank" rel="noreferrer"><span>Live x402 settlement</span><code>${short(state.evidence.paymentTx,10,6)}</code></a></div><div class="lock-note">Scenario amounts are interactive product state. Evidence links prove the live protocol paths and are labeled with their actual amounts.</div></section></aside></div>`;
}

function gate(heading, copy) { return `<section class="card"><div class="empty"><h2>${heading}</h2><p>${copy}</p><button class="button" data-action="go-setup">Open founding setup</button></div></section>`; }

async function connectWallet(memberId) {
  if (!window.ethereum) return showToast('No browser wallet was detected. Use the demo identity control for this product sandbox.', true);
  try {
    const [address] = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const message = `Sign in to Pact\nThis does not move funds.\nWallet: ${address}`;
    await window.ethereum.request({ method: 'personal_sign', params: [message, address] });
    await act('verify-member', { memberId, method: 'wallet', walletAddress: address });
  } catch (error) { showToast(error.message || 'Wallet verification was cancelled.', true); }
}

document.addEventListener('click', async event => {
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) { view = viewButton.dataset.view; return render(); }
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const name = button.dataset.action;
  if (name === 'reset') { if (confirm('Reset the product sandbox? This never changes blockchain state.')) await request('/api/reset', { method: 'POST', body: '{}' }); return; }
  if (name === 'save-pact') {
    const allocations = Object.fromEntries([...document.querySelectorAll('.allocation')].map(input => [input.dataset.memberId, Math.round(Number(input.value) * 100)]));
    return act('save-pact', { name: document.querySelector('#team-name').value, purpose: document.querySelector('#team-purpose').value, threshold: Number(document.querySelector('#threshold').value), allocations });
  }
  if (name === 'connect-wallet') return connectWallet(button.dataset.memberId);
  if (name === 'verify-demo') return act('verify-member', { memberId: button.dataset.memberId, method: 'demo' });
  if (name === 'accept-pact') return act('accept-pact', { memberId: button.dataset.memberId });
  if (name === 'activate-pact') return act('activate-pact');
  if (name === 'fund-treasury') return act('fund-treasury', { amountAtomic: 100_000_000 });
  if (name === 'go-treasurer') { view = 'treasurer'; return render(); }
  if (name === 'go-setup') { view = 'setup'; return render(); }
  if (name === 'create-budget' || name === 'new-budget') {
    if (name === 'new-budget') return showToast('Return the scenario to a funded treasury or reset it before issuing additional capital.');
    return act('create-budget', { amountAtomic: Math.round(Number(document.querySelector('#budget-amount').value) * 1_000_000), purpose: document.querySelector('#budget-purpose').value });
  }
  if (name === 'approve-budget') return act('approve-budget', { budgetId: button.dataset.budgetId, memberId: button.dataset.memberId });
  if (name === 'issue-budget') return act('issue-budget', { budgetId: button.dataset.budgetId });
  if (name === 'run-agent') return act('run-agent', { task: document.querySelector('#agent-task').value });
  if (name === 'low-balance') { await act('set-low-balance'); return showToast('Agent balance is now 0.03 USDC. Run Qwen to see the boundary hold.'); }
});

load();
