import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Activity, ArrowDownRight, ArrowRight, Check, CheckCircle2,
  ChevronDown, CircleAlert, CircleDashed, ClipboardCheck, Clock3, Code2,
  Copy, Cpu, FileCheck, FileWarning, FolderClosed, GitBranch, Info, LockKeyhole,
  Radar, RefreshCw, ScanSearch, Shield, ShieldAlert, ShieldCheck,
  Sparkles, Terminal, TriangleAlert, XCircle
} from 'lucide-react'

type Status = 'READY'|'BLOCKED'|'NEEDS_REVIEW'
type ItemStatus = 'VERIFIED'|'BLOCKED'|'UNVERIFIED'|'CONFLICT'
type Mode = 'preview'|'agent'
type Project = { id:string; name:string; client:string; owner:string; target_date:string; description:string }
type Evidence = { source:string; status:string; detail:string }
type Requirement = { id:string; title:string; kind:string; critical:boolean; status:ItemStatus; reason:string; evidence:Evidence[] }
type ToolEvent = {
  tool: string
  title: string
  order: number
  status: 'verified' | 'blocked' | 'warning' | 'error' | 'empty'
  detail: string
  source_ids: string[]
  evidence_count: number
  has_error: boolean
}
type Review = {
  summary: string
  tool_calls: string[]
  tool_call_count: number
  execution_trace?: ToolEvent[]
  complete: boolean
  warning: string | null
  model?: string
}
type Audit = {
  project_id: string
  project_name: string
  client: string
  status: Status
  summary: string
  counts: Record<ItemStatus, number>
  total: number
  requirements: Requirement[]
  blockers: Requirement[]
  next_actions: string[]
  mode: Mode
  agent_review: Review | null
  policy: string
}
type Health = { ok: boolean; agent_configured: boolean; project_count: number }

const projectDemoLabels: Record<string, string> = {
  storefront: 'NovaCommerce Storefront [Demo: Blocked by QA Failure]',
  ready: 'Atlas Agency Website [Demo: All Verified Ready]',
  missing: 'Orbit Mobile Portal [Demo: Missing Evidence]',
  conflicting: 'Beacon CRM Migration [Demo: Conflicting Records]',
  outage: 'Mercury API Handoff [Demo: External Source Outage]'
}

const projectDemoBadges: Record<string, { badge: string; type: 'success' | 'danger' | 'warning' | 'muted' }> = {
  storefront: { badge: 'Blocked by Failed QA (QA-224)', type: 'danger' },
  ready: { badge: 'Fully Verified & Ready for Signoff', type: 'success' },
  missing: { badge: 'Missing Test & Signoff Records', type: 'warning' },
  conflicting: { badge: 'Conflicting Test Evidence', type: 'warning' },
  outage: { badge: 'External QA Source Outage', type: 'danger' }
}

const toolNames: Record<string, string> = {
  read_project_brief: 'Read project brief',
  inspect_deliverables: 'Inspect deliverables',
  inspect_test_results: 'Inspect test evidence',
  inspect_client_approvals: 'Inspect client approvals'
}

const badgeLabel: Record<ItemStatus, string> = {
  VERIFIED: 'Verified',
  BLOCKED: 'Blocked',
  UNVERIFIED: 'Unverified',
  CONFLICT: 'Conflict'
}

const stateLabel: Record<Status, string> = {
  READY: 'Handoff ready',
  BLOCKED: 'Handoff blocked',
  NEEDS_REVIEW: 'Needs human review'
}

function Flag({ children, type = 'muted' }: { children: ReactNode; type?: string }) {
  return <span className={'flag ' + type}>{children}</span>
}

function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [active, setActive] = useState('storefront')
  const [mode, setMode] = useState<Mode>('preview')
  const [audit, setAudit] = useState<Audit | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [filter, setFilter] = useState<'all' | 'open' | 'passed'>('all')

  useEffect(() => {
    Promise.all([
      fetch('/api/projects').then(r => {
        if (!r.ok) throw new Error('Unable to load projects')
        return r.json()
      }),
      fetch('/api/health').then(r => {
        if (!r.ok) throw new Error('Unable to connect to backend')
        return r.json()
      })
    ]).then(([ps, hs]) => {
      setProjects(ps)
      setHealth(hs)
    }).catch(() => {
      setError('Cannot connect to the backend. Start FastAPI at localhost:8000, then refresh this page.')
    })
  }, [])

  const selected = projects.find(p => p.id === active)
  const demoBadge = active ? projectDemoBadges[active] : null

  const visible = useMemo(() => {
    return audit?.requirements.filter(r => (
      filter === 'all' ||
      (filter === 'open' && r.status !== 'VERIFIED') ||
      (filter === 'passed' && r.status === 'VERIFIED')
    )) || []
  }, [audit, filter])

  const verified = audit?.counts.VERIFIED ?? 0
  const fraction = audit && audit.total > 0 ? Math.round(100 * verified / audit.total) : 0

  async function runAudit(nextMode: Mode = mode, projectId: string = active) {
    setBusy(true)
    setError('')
    setCopied(false)
    try {
      const response = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, mode: nextMode })
      })
      const body = await response.json()
      if (!response.ok) {
        throw new Error(typeof body.detail === 'string' ? body.detail : 'Audit failed')
      }
      setAudit(body as Audit)
      setFilter('all')
      if (nextMode !== mode) {
        setMode(nextMode)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected audit failure')
    } finally {
      setBusy(false)
    }
  }

  function changeProject(id: string) {
    setActive(id)
    setAudit(null)
    setError('')
    setCopied(false)
  }

  async function copySummary() {
    if (!audit) return
    const body = [
      `HANDOFFPROOF — ${audit.project_name}`,
      `Mode: ${audit.mode === 'agent' ? 'Google ADK Agent' : 'Offline Evidence Preview'}`,
      `Decision: ${stateLabel[audit.status]}`,
      audit.summary,
      '',
      ...audit.requirements.map(r => `${r.status}: ${r.title} — ${r.reason}\nEvidence: ${r.evidence.map(e => `${e.source} (${e.status})`).join(', ') || 'none'}`),
      '',
      'NEXT ACTIONS',
      ...audit.next_actions.map((x, i) => `${i + 1}. ${x}`),
      '',
      'HUMAN GATE: Release requires formal human stakeholder authorization.',
      'Policy: ' + audit.policy
    ].join('\n')

    try {
      await navigator.clipboard.writeText(body)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2200)
    } catch {
      setError('Clipboard unavailable. Select text from the report manually.')
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-logo"><ShieldCheck size={22} strokeWidth={2.5} /></span>
          <div>
            <strong>handoff<span>proof</span></strong>
            <small>DELIVERY INTELLIGENCE</small>
          </div>
        </div>
        <div className="nav-section-label">WORKSPACE</div>
        <div className="nav-link active">
          <Radar size={18} />
          <span>Audit overview</span>
          <span className="nav-dot" />
        </div>
        <div className="nav-link disabled">
          <FolderClosed size={18} />
          <span>Projects</span>
          <Flag>5 demos</Flag>
        </div>
        <div className="nav-link disabled">
          <GitBranch size={18} />
          <span>Evidence graph</span>
        </div>
        <div className="sidebar-divider" />
        <div className="nav-section-label">DEMO ENVIRONMENT</div>
        <div className="demo-note">
          <span className="live-indicator" />
          Sandbox workspace
          <br />
          <small>All data is simulated. Read-only tools. Human authorization required.</small>
        </div>
        <div className="sidebar-spacer" />
        <div className="sidebar-help">
          <LockKeyhole size={16} />
          <div>
            <strong>Evidence-first by design</strong>
            <p>The policy engine is immutable. The LLM cannot grant self-approval.</p>
          </div>
        </div>
        <div className="sidebar-bottom">
          <span className="avatar">HP</span>
          <div>
            <strong>Hackathon Workspace</strong>
            <small>Track 4 · Google ADK</small>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="crumb">
            Workspace <span>/</span> Project audits <span>/</span> <strong>Overview</strong>
          </div>
          <div className="top-right">
            <Flag type="success"><span className="small-dot" /> Local demo</Flag>
            <span className="top-divider" />
            <span className="hack-label"><Code2 size={15} /> Built for evidence</span>
          </div>
        </header>

        <div className="content">
          <section className="hero">
            <div className="eyebrow">
              <span className="spark"><Sparkles size={13} /></span>
              EVIDENCE-BASED HANDOFF INTELLIGENCE
              <span className="eyebrow-line" />
            </div>
            <div className="hero-line">
              <div>
                <h1>Make every handoff<br /><em>defensible.</em></h1>
                <p>Stop guessing whether a project is ready. Inspect deliverables, test records, and client approvals—then produce a verdict backed by actual evidence.</p>
              </div>
              <div className="hero-illustration">
                <div className="orbit orbit-one" />
                <div className="orbit orbit-two" />
                <div className="orbit orbit-three" />
                <div className="orbit-mark"><ShieldCheck size={48} strokeWidth={1.3} /></div>
                <span className="orbit-label label-top"><CheckCircle2 size={13} /> Verified</span>
                <span className="orbit-label label-bottom"><Activity size={13} /> Tool calling</span>
              </div>
            </div>
          </section>

          <section className="section-grid">
            {/* Panel 01: Audit Setup */}
            <div className="panel audit-setup">
              <div className="panel-head">
                <div>
                  <span className="section-kicker">01 / CONFIGURATION</span>
                  <h2>Run an audit</h2>
                </div>
                <span className="panel-icon"><ScanSearch size={20} /></span>
              </div>

              <label className="field-label" htmlFor="project">SELECT DEMO SCENARIO</label>
              <div className="select-wrap">
                <select id="project" value={active} onChange={e => changeProject(e.target.value)}>
                  {projects.length ? projects.map(p => (
                    <option value={p.id} key={p.id}>
                      {projectDemoLabels[p.id] || p.name}
                    </option>
                  )) : <option>Loading projects...</option>}
                </select>
                <ChevronDown size={17} />
              </div>

              {selected && (
                <div className="project-detail">
                  <span className="project-avatar">{selected.client.split(' ').map(s => s[0]).slice(0, 2).join('')}</span>
                  <div>
                    <strong>{selected.client} — {selected.name}</strong>
                    <small>{selected.owner} · Target: {selected.target_date}</small>
                    {demoBadge && (
                      <div style={{ marginTop: '5px' }}>
                        <Flag type={demoBadge.type}>{demoBadge.badge}</Flag>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <label className="field-label mode-title">AUDIT EXECUTION MODE</label>
              <div className="mode-choices">
                <button
                  className={'mode-choice ' + (mode === 'preview' ? 'selected' : '')}
                  onClick={() => setMode('preview')}
                >
                  <Terminal size={17} />
                  <strong>Evidence preview</strong>
                  <small>Offline · Deterministic rules</small>
                </button>
                <button
                  className={'mode-choice ' + (mode === 'agent' ? 'selected' : '')}
                  onClick={() => setMode('agent')}
                >
                  <Sparkles size={17} />
                  <strong>Google ADK agent</strong>
                  <small>Real model + 4 tool calls</small>
                </button>
              </div>

              <button
                className="primary-cta"
                onClick={() => runAudit()}
                disabled={busy || !selected}
              >
                {busy ? (
                  <RefreshCw size={18} className="spin" />
                ) : (
                  <ScanSearch size={18} />
                )}
                {busy ? (
                  mode === 'agent' ? 'Executing Google ADK tools…' : 'Evaluating evidence policy…'
                ) : (
                  mode === 'agent' ? 'Run Google ADK agent audit' : 'Run evidence preview'
                )}
                <ArrowRight size={18} />
              </button>

              <div className="setup-note">
                <Info size={15} />
                {mode === 'preview'
                  ? 'Evidence Preview executes offline deterministic rules without calling external AI models.'
                  : health?.agent_configured
                    ? 'Google API key active. Real Google ADK Agent will execute 4 read-only evidence tools.'
                    : 'Google ADK requires GOOGLE_API_KEY configured in backend/.env.'}
              </div>
            </div>

            {/* Panel 02: Readiness Verdict */}
            <div className="panel report-panel">
              <div className="panel-head">
                <div>
                  <span className="section-kicker">02 / AUDIT RESULT</span>
                  <h2>Readiness verdict</h2>
                </div>
                <button
                  className="icon-btn"
                  disabled={!audit || busy}
                  onClick={() => runAudit()}
                  title="Re-run current audit"
                >
                  <RefreshCw size={17} />
                </button>
              </div>

              {!audit ? (
                <div className="empty-state">
                  <div className="empty-icon"><Shield size={39} strokeWidth={1.4} /></div>
                  <strong>No audit run yet</strong>
                  <p>Select a sample scenario and click “Run audit” to inspect delivery readiness.</p>
                </div>
              ) : (
                <div className="result-box">
                  <div className={`mode-badge-indicator ${audit.mode}`}>
                    {audit.mode === 'agent' ? (
                      <><Sparkles size={12} /> Google ADK Agent Review</>
                    ) : (
                      <><Terminal size={12} /> Deterministic Evidence Preview</>
                    )}
                  </div>

                  <div className={'verdict ' + audit.status.toLowerCase()}>
                    <span className="verdict-icon">
                      {audit.status === 'READY' ? <ShieldCheck size={24} /> :
                       audit.status === 'BLOCKED' ? <ShieldAlert size={24} /> :
                       <CircleAlert size={24} />}
                    </span>
                    <div>
                      <small>POLICY-ENFORCED STATUS</small>
                      <strong>{stateLabel[audit.status]}</strong>
                    </div>
                    <Flag type={audit.status === 'READY' ? 'success' : audit.status === 'BLOCKED' ? 'danger' : 'warning'}>
                      {audit.status.replace('_', ' ')}
                    </Flag>
                  </div>

                  {/* Blocker Callout if Blocked */}
                  {audit.status === 'BLOCKED' && audit.blockers.length > 0 && (
                    <div className="blocker-callout">
                      <div className="blocker-callout-head">
                        <ShieldAlert size={14} /> Explicit Handoff Blocker(s)
                      </div>
                      <ul className="blocker-list">
                        {audit.blockers.map(b => (
                          <li key={b.id}>
                            <strong>{b.title}:</strong> {b.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <p className="verdict-description">{audit.summary}</p>

                  <div className="progress-head">
                    <span>Requirements verified</span>
                    <strong>{verified} <span>/ {audit.total}</span></strong>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${fraction}%` }} />
                  </div>

                  <div className="metric-grid">
                    <div>
                      <CheckCircle2 size={17} className="ok" />
                      <strong>{audit.counts.VERIFIED}</strong>
                      <small>Verified</small>
                    </div>
                    <div>
                      <XCircle size={17} className="bad" />
                      <strong>{audit.counts.BLOCKED}</strong>
                      <small>Blocked</small>
                    </div>
                    <div>
                      <CircleDashed size={17} className="maybe" />
                      <strong>{audit.counts.UNVERIFIED + audit.counts.CONFLICT}</strong>
                      <small>Needs review</small>
                    </div>
                  </div>

                  <div className="human-guard-notice">
                    <LockKeyhole size={14} />
                    <span>
                      <strong>Human Sign-off Gate:</strong> Automated audits cannot self-authorize release. Formal human stakeholder sign-off is mandatory.
                    </span>
                  </div>

                  <button className="export-btn" onClick={copySummary}>
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    {copied ? 'Copied to clipboard' : 'Copy evidence report'}
                    <ArrowDownRight size={15} />
                  </button>
                </div>
              )}
            </div>
          </section>

          {error && (
            <div className="error-banner">
              <TriangleAlert size={19} />
              <span>{error}</span>
              <button onClick={() => setError('')}>Dismiss</button>
            </div>
          )}

          {/* Section 03: Requirement-level traceability */}
          <section className="panel details-panel">
            <div className="detail-heading">
              <div>
                <span className="section-kicker">03 / REQUIREMENT-LEVEL TRACEABILITY</span>
                <h2>Evidence breakdown</h2>
                <p>Every claim links directly to immutable source records. Missing or unverified data is never a pass.</p>
              </div>
              <div className="tab-group">
                <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</button>
                <button className={filter === 'open' ? 'on' : ''} onClick={() => setFilter('open')}>Needs attention</button>
                <button className={filter === 'passed' ? 'on' : ''} onClick={() => setFilter('passed')}>Verified</button>
              </div>
            </div>

            {!audit ? (
              <div className="detail-empty">
                <FileCheck size={24} />
                <span>Requirement evidence will appear here after an audit.</span>
              </div>
            ) : (
              <div className="req-list">
                {visible.length === 0 ? (
                  <div className="detail-empty">No requirements match this filter.</div>
                ) : visible.map((r, i) => (
                  <div className="req-row" key={r.id}>
                    <div className={'req-icon ' + r.status.toLowerCase()}>
                      {r.status === 'VERIFIED' ? <Check size={18} /> :
                       r.status === 'BLOCKED' ? <XCircle size={18} /> :
                       r.status === 'CONFLICT' ? <GitBranch size={18} /> :
                       <Clock3 size={18} />}
                    </div>
                    <div className="req-body">
                      <div className="req-top">
                        <strong>{r.title}</strong>
                        <Flag type={r.status === 'VERIFIED' ? 'success' : r.status === 'BLOCKED' ? 'danger' : 'warning'}>
                          {badgeLabel[r.status]}
                        </Flag>
                      </div>
                      <p>{r.reason}</p>
                      <div className="evidence-chips">
                        <span className="evidence-category">{r.kind}</span>
                        {r.evidence.length ? r.evidence.map((e, j) => (
                          <span className="evidence-chip" key={j} title={e.detail}>
                            <ClipboardCheck size={12} />
                            {e.source} <span>· {e.status}</span>
                          </span>
                        )) : (
                          <span className="no-evidence"><FileWarning size={12} /> No trusted evidence</span>
                        )}
                      </div>
                    </div>
                    <span className="req-number">{String(i + 1).padStart(2, '0')}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Bottom Grid: 04 Remediation & 05 Execution Trace */}
          <section className="bottom-grid">
            <div className="panel next-actions">
              <div className="panel-head">
                <div>
                  <span className="section-kicker">04 / REMEDIATION</span>
                  <h2>Next best actions</h2>
                </div>
                <span className="panel-icon"><ArrowRight size={19} /></span>
              </div>
              {!audit ? (
                <p className="placeholder-line">Complete an audit to generate prioritized next steps.</p>
              ) : (
                <div className="actions-list">
                  {audit.next_actions.map((action, i) => (
                    <div className="action-row" key={i}>
                      <span>{String(i + 1).padStart(2, '0')}</span>
                      <p>{action}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Panel 05: Visual Tool Execution Timeline */}
            <div className="panel tool-panel">
              <div className="panel-head">
                <div>
                  <span className="section-kicker">05 / EXECUTION TIMELINE</span>
                  <h2>Agent tool activity</h2>
                </div>
                <span className="panel-icon"><Activity size={19} /></span>
              </div>

              {!audit ? (
                <div className="trace-empty">Run in Google ADK mode to see actual tool invocations.</div>
              ) : audit.mode === 'preview' ? (
                /* Offline Preview Mode Banner */
                <div className="preview-mode-card">
                  <div className="preview-mode-head">
                    <Terminal size={22} className="preview-mode-icon" />
                    <div>
                      <strong>Offline Evidence Preview Mode</strong>
                      <small>Evaluated by deterministic rules · Zero AI calls</small>
                    </div>
                    <Flag type="muted">Deterministic</Flag>
                  </div>
                  <p className="preview-mode-desc">
                    This preview evaluates your project against deterministic handoff policy rules without calling an AI model. To inspect live Google ADK tool execution and AI narration, switch to Agent Mode.
                  </p>
                  <div className="preview-mode-features">
                    <div><Check size={14} className="text-lime-400" /> Mathematically certified policy decisions</div>
                    <div><Check size={14} className="text-lime-400" /> Missing evidence treated strictly as unverified</div>
                    <div><Check size={14} className="text-lime-400" /> Cached passes revoked during source outages</div>
                  </div>
                  <button className="preview-switch-btn" onClick={() => runAudit('agent')}>
                    <Sparkles size={15} /> Switch to Google ADK Agent Mode & Run <ArrowRight size={15} />
                  </button>
                </div>
              ) : (
                /* Real Google ADK Execution Timeline */
                <div className="timeline-container">
                  <div className="timeline-header">
                    <div className="timeline-tag">
                      <Cpu size={14} />
                      <span>Google ADK Agent</span>
                      <span className="timeline-model">{audit.agent_review?.model || 'gemini-2.5-flash'}</span>
                    </div>
                    <Flag type={audit.agent_review?.complete ? 'success' : 'warning'}>
                      {audit.agent_review?.complete ? '4 / 4 Tools Executed' : `${audit.agent_review?.tool_call_count || 0}/4 Tools Executed`}
                    </Flag>
                  </div>

                  {audit.agent_review?.execution_trace && audit.agent_review.execution_trace.length > 0 ? (
                    <div className="timeline-steps">
                      {audit.agent_review.execution_trace.map((evt) => (
                        <div key={evt.order} className={`timeline-item ${evt.status}`}>
                          <div className="timeline-marker">
                            #{evt.order}
                          </div>
                          <div className="timeline-card">
                            <div className="timeline-card-head">
                              <div className="timeline-tool-title">
                                <strong>{evt.title}</strong>
                                <code>{evt.tool}()</code>
                              </div>
                              <Flag type={
                                evt.status === 'verified' ? 'success' :
                                evt.status === 'blocked' ? 'danger' :
                                evt.status === 'error' ? 'danger' :
                                evt.status === 'warning' ? 'warning' : 'muted'
                              }>
                                {evt.status === 'verified' ? 'Verified' :
                                 evt.status === 'blocked' ? 'Blocked' :
                                 evt.status === 'error' ? 'Source Outage' :
                                 evt.status === 'warning' ? 'Pending Review' : 'No Records'}
                              </Flag>
                            </div>
                            <p className="timeline-detail">{evt.detail}</p>
                            {evt.source_ids && evt.source_ids.length > 0 && (
                              <div className="timeline-sources">
                                <span className="timeline-sources-label">Sources:</span>
                                {evt.source_ids.map((sid) => (
                                  <span key={sid} className="timeline-source-pill">
                                    <ClipboardCheck size={10} /> {sid}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    /* Fallback trace if execution_trace was not present */
                    <div className="trace-list">
                      {Object.entries(toolNames).map(([key, label]) => (
                        <div key={key} className="trace-row">
                          <span className={'trace-icon ' + (audit.agent_review?.tool_calls.includes(key) ? 'called' : 'uncalled')}>
                            {audit.agent_review?.tool_calls.includes(key) ? <Check size={14} /> : <CircleDashed size={14} />}
                          </span>
                          <span>{label}</span>
                          <small>{audit.agent_review?.tool_calls.includes(key) ? 'Called' : 'Not called'}</small>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Agent Verified Commentary */}
                  <div className="agent-commentary-box">
                    <div className="agent-commentary-head">
                      <Sparkles size={14} />
                      <strong>Agent Verified Commentary</strong>
                      <span className="guard-pill">Policy-Enforced</span>
                    </div>
                    <p className="agent-commentary-text">
                      {audit.agent_review?.summary || audit.agent_review?.warning || 'No verified agent explanation available.'}
                    </p>
                    {audit.agent_review?.warning && (
                      <div className="agent-warning-banner">
                        <TriangleAlert size={14} />
                        <span>{audit.agent_review.warning}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          <footer>
            <div>
              <ShieldCheck size={15} />
              HANDOFFPROOF <span>·</span> Hackathon prototype
            </div>
            <span>Sample data only · Read-only tools · Human approval required</span>
          </footer>
        </div>
      </main>
    </div>
  )
}

export default App
