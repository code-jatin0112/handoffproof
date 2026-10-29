import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  Activity,
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Copy,
  Cpu,
  FileCheck,
  FolderGit2,
  GitBranch,
  Layers,
  Lock,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
  XCircle
} from 'lucide-react'

type Status = 'READY' | 'BLOCKED' | 'NEEDS_REVIEW'
type ItemStatus = 'VERIFIED' | 'BLOCKED' | 'UNVERIFIED' | 'CONFLICT'
type Mode = 'agent' | 'preview'
type Project = { id: string; name: string; client: string; owner: string; target_date: string; description: string }
type Evidence = { source: string; status: string; detail: string }
type Requirement = { id: string; title: string; kind: string; critical: boolean; status: ItemStatus; reason: string; evidence: Evidence[] }
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
type Health = { ok: boolean; agent_configured: boolean; model?: string; project_count: number }

const projectScenarios: Record<string, { tag: string; type: 'danger' | 'success' | 'warning' }> = {
  storefront: { tag: 'QA Blocker', type: 'danger' },
  ready: { tag: 'Verified Ready', type: 'success' },
  missing: { tag: 'Missing Data', type: 'warning' },
  conflicting: { tag: 'Conflict', type: 'warning' },
  outage: { tag: 'Source Outage', type: 'danger' }
}

const statusConfig: Record<Status, { label: string; text: string; icon: typeof ShieldCheck }> = {
  READY: { label: 'Handoff Ready', text: 'All criteria verified with supporting evidence.', icon: ShieldCheck },
  BLOCKED: { label: 'Handoff Blocked', text: 'Explicit test failure or incomplete deliverable detected.', icon: ShieldAlert },
  NEEDS_REVIEW: { label: 'Needs Human Review', text: 'Evidence missing, conflicting, or source unavailable.', icon: AlertCircle }
}

const itemStatusConfig: Record<ItemStatus, { label: string; class: string; icon: typeof Check }> = {
  VERIFIED: { label: 'Verified', class: 'verified', icon: Check },
  BLOCKED: { label: 'Blocked', class: 'blocked', icon: XCircle },
  UNVERIFIED: { label: 'Unverified', class: 'unverified', icon: Clock },
  CONFLICT: { label: 'Conflict', class: 'conflict', icon: GitBranch }
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [activeId, setActiveId] = useState<string>('storefront')
  const [mode, setMode] = useState<Mode>('agent')
  const [audit, setAudit] = useState<Audit | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [filter, setFilter] = useState<'all' | 'open' | 'passed'>('all')
  const [expandedReqs, setExpandedReqs] = useState<Record<string, boolean>>({})
  const [inspectingSource, setInspectingSource] = useState<string | null>(null)

  // Load project list & health
  useEffect(() => {
    Promise.all([
      fetch('/api/projects').then(r => {
        if (!r.ok) throw new Error('Unable to fetch project list')
        return r.json()
      }),
      fetch('/api/health').then(r => {
        if (!r.ok) throw new Error('Backend health probe failed')
        return r.json()
      })
    ]).then(([ps, hs]) => {
      setProjects(ps)
      setHealth(hs)
    }).catch(() => {
      setError('Cannot connect to backend server at localhost:8000. Ensure FastAPI is running.')
    })
  }, [])

  const selectedProject = projects.find(p => p.id === activeId)

  // Filter requirements
  const filteredRequirements = useMemo(() => {
    if (!audit) return []
    return audit.requirements.filter(r => {
      if (filter === 'open') return r.status !== 'VERIFIED'
      if (filter === 'passed') return r.status === 'VERIFIED'
      return true
    })
  }, [audit, filter])

  const verifiedCount = audit?.counts.VERIFIED ?? 0
  const progressPct = audit && audit.total > 0 ? Math.round((verifiedCount / audit.total) * 100) : 0

  // Lookup detail for active inspected evidence source
  const inspectedRecord = useMemo(() => {
    if (!inspectingSource || !audit) return null
    for (const req of audit.requirements) {
      const match = req.evidence.find(e => e.source === inspectingSource)
      if (match) {
        return { ...match, requirementId: req.id, requirementTitle: req.title }
      }
    }
    return null
  }, [inspectingSource, audit])

  function handleInspectSource(sid: string) {
    if (inspectingSource === sid) {
      setInspectingSource(null)
    } else {
      setInspectingSource(sid)
      // Automatically expand matching requirement card in Column A
      const matchReq = audit?.requirements.find(r => r.evidence.some(e => e.source === sid))
      if (matchReq) {
        setExpandedReqs(prev => ({ ...prev, [matchReq.id]: true }))
      }
    }
  }

  // Run Audit
  const runAudit = useCallback(async (targetMode: Mode = mode, targetProjectId: string = activeId) => {
    setBusy(true)
    setError('')
    setCopied(false)
    setInspectingSource(null)
    try {
      const response = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: targetProjectId, mode: targetMode })
      })
      const body = await response.json()
      if (!response.ok) {
        throw new Error(typeof body.detail === 'string' ? body.detail : 'Audit failed')
      }
      setAudit(body as Audit)
      setFilter('all')
      if (targetMode !== mode) {
        setMode(targetMode)
      }
      // Expand blocked requirements automatically for inspection
      const initialExpanded: Record<string, boolean> = {}
      body.requirements?.forEach((r: Requirement) => {
        if (r.status !== 'VERIFIED') initialExpanded[r.id] = true
      })
      setExpandedReqs(initialExpanded)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected audit error')
    } finally {
      setBusy(false)
    }
  }, [mode, activeId])

  // Keyboard shortcut: Cmd+Enter / Ctrl+Enter to trigger audit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        if (!busy && selectedProject) {
          runAudit()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [runAudit, busy, selectedProject])

  function handleSelectProject(id: string) {
    if (id === activeId) return
    setActiveId(id)
    setAudit(null)
    setError('')
    setCopied(false)
    setInspectingSource(null)
  }

  function toggleRequirementExpand(id: string) {
    setExpandedReqs(prev => ({ ...prev, [id]: !prev[id] }))
  }

  async function handleCopyReport() {
    if (!audit) return
    const content = [
      `=======================================================`,
      `HANDOFFPROOF EVIDENCE AUDIT REPORT — ${audit.project_name.toUpperCase()}`,
      `=======================================================`,
      `Client: ${audit.client}`,
      `Mode: ${audit.mode === 'agent' ? 'Google ADK Agent Audit' : 'Offline Deterministic Preview'}`,
      `Status: ${statusConfig[audit.status].label.toUpperCase()}`,
      `Policy Summary: ${audit.summary}`,
      `Requirements Verified: ${audit.counts.VERIFIED}/${audit.total}`,
      ``,
      `--- CONTRACTUAL REQUIREMENTS ---`,
      ...audit.requirements.map(r => (
        `[${r.status}] ${r.title} (${r.kind.toUpperCase()})\n  Reason: ${r.reason}\n  Evidence: ${r.evidence.map(e => `${e.source} [${e.status}] - ${e.detail}`).join('; ') || 'None'}`
      )),
      ``,
      `--- REMEDIATION / NEXT ACTIONS ---`,
      ...audit.next_actions.map((act, i) => `${i + 1}. ${act}`),
      ``,
      `--- GOVERNANCE NOTICE ---`,
      `Human Approval Required: AI agents assist audit verification but cannot self-authorize client releases. Formal sign-off is mandatory.`,
      `Policy: ${audit.policy}`,
      `Generated by HandoffProof (Track 4 Google ADK)`
    ].join('\n')

    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2400)
    } catch {
      setError('Clipboard unavailable. Please copy text manually from report.')
    }
  }

  return (
    <div className="app-container">
      {/* 1. SIDEBAR NAVIGATION */}
      <aside className="app-sidebar" aria-label="Project Navigation">
        <div className="sidebar-header">
          <div className="brand-wrapper">
            <div className="brand-mark">
              <ShieldCheck size={18} strokeWidth={2.5} />
            </div>
            <div>
              <div className="brand-text">handoff<span>proof</span></div>
            </div>
          </div>
          <span className="brand-pill">Track 4</span>
        </div>

        <div className="sidebar-content">
          <div>
            <div className="sidebar-section-title">Demo Scenarios</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {projects.map(p => {
                const badge = projectScenarios[p.id]
                const isActive = p.id === activeId
                return (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => handleSelectProject(p.id)}
                    className={`project-nav-item ${isActive ? 'active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <div className="project-nav-top">
                      <span className="project-nav-name">{p.name}</span>
                      {badge && (
                        <span className={`project-nav-badge ${badge.type}`}>
                          {badge.tag}
                        </span>
                      )}
                    </div>
                    <span className="project-nav-client">{p.client}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div style={{ marginTop: 'auto' }}>
            <div className="sidebar-section-title">System Architecture</div>
            <div className="trust-badge-card">
              <Layers size={16} className="trust-badge-icon" />
              <div className="trust-badge-text">
                <strong>Google ADK + Policy</strong>
                4 read-only tools extract evidence; an immutable policy engine issues mathematical verdicts.
              </div>
            </div>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="trust-badge-card" style={{ background: 'transparent', border: 'none', padding: '0' }}>
            <Lock size={14} style={{ color: '#94a3b8', flexShrink: 0, marginTop: '2px' }} />
            <div className="trust-badge-text" style={{ fontSize: '10px', color: '#64748b' }}>
              All demonstration datasets are simulated contracts. AI tools run read-only.
            </div>
          </div>
        </div>
      </aside>

      {/* 2. MAIN APPLICATION WORKSPACE */}
      <div className="app-main">
        {/* Top Navbar */}
        <header className="top-navbar">
          <nav className="breadcrumb-nav" aria-label="Breadcrumbs">
            <span>Workspaces</span>
            <span>/</span>
            <span>Client Audits</span>
            <span>/</span>
            <span className="breadcrumb-active">{selectedProject?.name || 'Project'}</span>
          </nav>
          <div className="top-actions">
            <div className="system-status-indicator">
              <span className="status-dot-active" />
              <span>{health?.model ? `${health.model} Active` : 'FastAPI Connected'}</span>
            </div>
            <a
              href="https://github.com/code-jatin0112/handoffproof"
              target="_blank"
              rel="noreferrer"
              className="btn-secondary"
              style={{ textDecoration: 'none' }}
              aria-label="View source on GitHub"
            >
              <FolderGit2 size={14} />
              <span>GitHub</span>
            </a>
          </div>
        </header>

        {/* Viewport Canvas */}
        <main className="workspace-viewport">
          {/* Error Banner */}
          {error && (
            <div className="error-toast-banner" role="alert">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
              <button
                type="button"
                onClick={() => setError('')}
                style={{ background: 'transparent', border: 'none', color: '#fecdd3', cursor: 'pointer' }}
                aria-label="Dismiss error"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Project Header Card */}
          {selectedProject && (
            <section className="project-header-panel" aria-label="Project Information">
              <div className="project-info-column">
                <div className="project-title-row">
                  <h1 className="project-heading">{selectedProject.name}</h1>
                  {projectScenarios[selectedProject.id] && (
                    <span className={`project-nav-badge ${projectScenarios[selectedProject.id].type}`} style={{ fontSize: '11px', padding: '3px 8px' }}>
                      {projectScenarios[selectedProject.id].tag}
                    </span>
                  )}
                </div>
                <p className="project-description">{selectedProject.description}</p>
                <div className="project-metadata-strip">
                  <div className="metadata-item">
                    <span>Client:</span>
                    <strong>{selectedProject.client}</strong>
                  </div>
                  <span>•</span>
                  <div className="metadata-item">
                    <span>Owner:</span>
                    <strong>{selectedProject.owner}</strong>
                  </div>
                  <span>•</span>
                  <div className="metadata-item">
                    <Clock size={13} style={{ color: '#64748b' }} />
                    <span>Target:</span>
                    <strong>{selectedProject.target_date}</strong>
                  </div>
                </div>
              </div>

              <div className="project-actions-column">
                <div className="mode-toggle-segmented" role="radiogroup" aria-label="Audit Mode">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={mode === 'agent'}
                    className={`segmented-option ${mode === 'agent' ? 'active agent' : ''}`}
                    onClick={() => setMode('agent')}
                    title="Real Google ADK Agent with 4 tool executions and Gemini model"
                  >
                    <Sparkles size={13} />
                    <span>Google ADK Agent</span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={mode === 'preview'}
                    className={`segmented-option ${mode === 'preview' ? 'active' : ''}`}
                    onClick={() => setMode('preview')}
                    title="100% offline deterministic policy calculation"
                  >
                    <Terminal size={13} />
                    <span>Evidence Preview</span>
                  </button>
                </div>

                <button
                  type="button"
                  className="run-audit-button"
                  onClick={() => runAudit()}
                  disabled={busy}
                  title="Run Audit (Shortcut: ⌘+Enter)"
                  aria-label={busy ? 'Audit in progress' : 'Execute project audit'}
                >
                  {busy ? (
                    <RefreshCw size={15} style={{ animation: 'spin 0.8s linear infinite' }} />
                  ) : (
                    <ScanSearch size={15} />
                  )}
                  <span>
                    {busy
                      ? mode === 'agent'
                        ? 'Executing ADK Tools…'
                        : 'Checking Policy…'
                      : mode === 'agent'
                        ? 'Run ADK Audit'
                        : 'Preview Policy'}
                  </span>
                </button>
              </div>
            </section>
          )}

          {/* Executive Verdict Banner (Shows when audit has executed) */}
          {audit ? (
            <section className={`executive-verdict-card ${audit.status.toLowerCase()}`} aria-label="Audit Results">
              <div className="verdict-header-row">
                <div className="verdict-main-meta">
                  <div className="verdict-icon-container">
                    {audit.status === 'READY' ? (
                      <ShieldCheck size={26} strokeWidth={2.2} />
                    ) : audit.status === 'BLOCKED' ? (
                      <ShieldAlert size={26} strokeWidth={2.2} />
                    ) : (
                      <AlertCircle size={26} strokeWidth={2.2} />
                    )}
                  </div>
                  <div className="verdict-text-block">
                    <div className="verdict-badge-line">
                      <h2 className="verdict-status-title">
                        {statusConfig[audit.status].label}
                      </h2>
                      <span className={`project-nav-badge ${audit.status === 'READY' ? 'success' : audit.status === 'BLOCKED' ? 'danger' : 'warning'}`}>
                        Policy Enforced
                      </span>
                      {audit.mode === 'agent' && (
                        <span className="project-nav-badge" style={{ background: 'rgba(99, 102, 241, 0.1)', color: '#a5b4fc', borderColor: 'rgba(99, 102, 241, 0.3)' }}>
                          Google ADK
                        </span>
                      )}
                    </div>
                    <p className="verdict-summary-prose">{audit.summary}</p>
                  </div>
                </div>

                <div className="verdict-actions-row">
                  <button type="button" className="btn-secondary" onClick={() => runAudit()} disabled={busy} title="Rerun current audit">
                    <RotateCcw size={13} />
                    <span>Re-audit</span>
                  </button>
                  <button type="button" className="btn-secondary" onClick={handleCopyReport}>
                    {copied ? <Check size={13} style={{ color: '#34d399' }} /> : <Copy size={13} />}
                    <span>{copied ? 'Copied' : 'Export Report'}</span>
                  </button>
                </div>
              </div>

              {/* Blocker Callout when Blocked */}
              {audit.status === 'BLOCKED' && audit.blockers.length > 0 && (
                <div className="blocker-alert-banner">
                  <ShieldAlert size={16} className="blocker-alert-icon" />
                  <div className="blocker-alert-content">
                    <span className="blocker-alert-title">Contractual Delivery Blocker Detected:</span>
                    <ul className="blocker-alert-items">
                      {audit.blockers.map(b => (
                        <li key={b.id}>
                          <strong>{b.title}:</strong> {b.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Metrics & Progress Strip */}
              <div className="verdict-metrics-strip">
                <div className="metric-progress-col">
                  <div className="progress-label-row">
                    <span>Requirements Verified</span>
                    <strong>{verifiedCount} / {audit.total} ({progressPct}%)</strong>
                  </div>
                  <div className="custom-progress-track">
                    <div className="custom-progress-fill" style={{ width: `${progressPct}%` }} />
                  </div>
                </div>
                <div className="metric-stat-box verified">
                  <span>Verified Pass</span>
                  <strong>{audit.counts.VERIFIED}</strong>
                </div>
                <div className="metric-stat-box blocked">
                  <span>Blocked</span>
                  <strong>{audit.counts.BLOCKED}</strong>
                </div>
                <div className="metric-stat-box review">
                  <span>Needs Review</span>
                  <strong>{audit.counts.UNVERIFIED + audit.counts.CONFLICT}</strong>
                </div>
              </div>
            </section>
          ) : (
            <div className="executive-verdict-card" style={{ padding: '0' }}>
              <div className="empty-audit-placeholder">
                <div className="placeholder-icon-ring">
                  <ScanSearch size={24} />
                </div>
                <strong>No Active Audit Certification</strong>
                <p>Click &ldquo;Run ADK Audit&rdquo; above (or press ⌘+Enter) to evaluate this project against contractual proof.</p>
              </div>
            </div>
          )}

          {/* 3. DUAL-COLUMN DEEP INSPECTION */}
          <section className="inspection-grid">
            {/* Column A: Contractual Evidence Inspector */}
            <div className="inspection-panel">
              <div className="panel-header-strip">
                <div className="panel-header-left">
                  <div className="panel-icon-badge">
                    <FileCheck size={16} />
                  </div>
                  <div>
                    <h3 className="panel-title">Contractual Proof Chain</h3>
                    <div className="panel-subtitle">Every requirement traced to immutable source records</div>
                  </div>
                </div>

                <div className="filter-tabs" role="tablist" aria-label="Requirements Filter">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={filter === 'all'}
                    className={`filter-tab ${filter === 'all' ? 'active' : ''}`}
                    onClick={() => setFilter('all')}
                  >
                    All ({audit?.requirements.length || 0})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={filter === 'open'}
                    className={`filter-tab ${filter === 'open' ? 'active' : ''}`}
                    onClick={() => setFilter('open')}
                  >
                    Blockers ({audit?.blockers.length || 0})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={filter === 'passed'}
                    className={`filter-tab ${filter === 'passed' ? 'active' : ''}`}
                    onClick={() => setFilter('passed')}
                  >
                    Verified ({verifiedCount})
                  </button>
                </div>
              </div>

              <div className="requirements-container">
                {audit ? (
                  filteredRequirements.length > 0 ? (
                    filteredRequirements.map(req => {
                      const isExpanded = expandedReqs[req.id] ?? false
                      const itemCfg = itemStatusConfig[req.status]
                      const StatusIcon = itemCfg.icon

                      return (
                        <div key={req.id} className="requirement-card">
                          <div className="requirement-header">
                            <div className="requirement-title-group">
                              <span className={`status-indicator-icon ${itemCfg.class}`}>
                                <StatusIcon size={12} strokeWidth={2.5} />
                              </span>
                              <span className="requirement-title">{req.title}</span>
                            </div>

                            <div className="requirement-tags">
                              <span className="kind-tag">{req.kind}</span>
                              <span className={`status-pill ${itemCfg.class}`}>
                                {itemCfg.label}
                              </span>
                              {req.evidence.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => toggleRequirementExpand(req.id)}
                                  className="btn-secondary"
                                  style={{ height: '24px', padding: '0 6px', fontSize: '10px' }}
                                  aria-expanded={isExpanded}
                                  aria-label={isExpanded ? `Collapse evidence for ${req.title}` : `Expand evidence for ${req.title}`}
                                >
                                  {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                </button>
                              )}
                            </div>
                          </div>

                          <p className="requirement-reason">{req.reason}</p>

                          {/* Expandable Evidence Tray with Interactive Inspection */}
                          {req.evidence.length > 0 && isExpanded && (
                            <div className="evidence-items-tray">
                              {req.evidence.map((ev, idx) => (
                                <button
                                  type="button"
                                  key={idx}
                                  className={`evidence-record-chip ${inspectingSource === ev.source ? 'highlighted' : ''}`}
                                  onClick={() => handleInspectSource(ev.source)}
                                  style={{ width: '100%', cursor: 'pointer', textAlign: 'left' }}
                                  aria-label={`Inspect evidence citation ${ev.source}`}
                                  aria-pressed={inspectingSource === ev.source}
                                >
                                  <div className="evidence-source-key">
                                    <Code2 size={11} />
                                    <span>{ev.source}</span>
                                    <span style={{ color: '#64748b', fontSize: '9px' }}>[{ev.status}]</span>
                                  </div>
                                  <span className="evidence-detail-text" title={ev.detail}>
                                    {ev.detail || 'Record registered in verified index.'}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })
                  ) : (
                    <div style={{ textAlign: 'center', padding: '24px', color: '#64748b', fontSize: '12px' }}>
                      No criteria match the selected filter.
                    </div>
                  )
                ) : (
                  <div style={{ textAlign: 'center', padding: '36px', color: '#64748b', fontSize: '12px' }}>
                    Run an audit to view contractual evidence breakdown.
                  </div>
                )}
              </div>
            </div>

            {/* Column B: Real Google ADK Agent Execution Timeline */}
            <div className="inspection-panel">
              <div className="panel-header-strip">
                <div className="panel-header-left">
                  <div className="panel-icon-badge" style={{ color: '#818cf8' }}>
                    <Activity size={16} />
                  </div>
                  <div>
                    <h3 className="panel-title">Google ADK Agent Execution</h3>
                    <div className="panel-subtitle">4 read-only tools executed sequentially via Gemini</div>
                  </div>
                </div>

                {!busy && audit?.mode === 'agent' && (
                  <span className="tool-count-badge">
                    {audit.agent_review?.complete ? '4 / 4 Tools Executed' : `${audit.agent_review?.tool_call_count || 0}/4 Tools`}
                  </span>
                )}
              </div>

              <div className="timeline-panel-body">
                {/* 1. Honest Active Running State (Issue 1) */}
                {busy ? (
                  <div className="active-running-card" role="status" aria-live="polite">
                    <div className="running-header">
                      <RefreshCw size={20} style={{ color: '#818cf8', animation: 'spin 1s linear infinite' }} />
                      <div>
                        <strong style={{ color: '#f8fafc', fontSize: '13px', display: 'block' }}>
                          {mode === 'agent' ? 'Google ADK Agent Audit In Progress…' : 'Evaluating Deterministic Policy…'}
                        </strong>
                        <span style={{ color: '#94a3b8', fontSize: '11px', display: 'block', marginTop: '3px' }}>
                          {mode === 'agent'
                            ? 'Orchestrating 4 read-only evidence tools via Gemini. Execution trace will render upon completion.'
                            : 'Computing contractual policy tables offline.'}
                        </span>
                      </div>
                    </div>
                    {mode === 'agent' && (
                      <div>
                        <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                          Planned Tool Sequence
                        </div>
                        <div className="running-tools-planned">
                          <span className="planned-tool-chip">1. read_project_brief()</span>
                          <span className="planned-tool-chip">2. inspect_deliverables()</span>
                          <span className="planned-tool-chip">3. inspect_test_results()</span>
                          <span className="planned-tool-chip">4. inspect_client_approvals()</span>
                        </div>
                        <p className="running-note" style={{ marginTop: '12px' }}>
                          Real tool invocations are being processed by Gemini with automatic secret redaction. Typical execution: ~6–12 seconds.
                        </p>
                      </div>
                    )}
                  </div>
                ) : !audit ? (
                  <div style={{ textAlign: 'center', padding: '36px', color: '#64748b', fontSize: '12px' }}>
                    Tool execution timeline will stream here after audit execution.
                  </div>
                ) : audit.mode === 'preview' ? (
                  /* Offline Preview Mode Banner */
                  <div className="preview-callout-panel">
                    <div className="preview-callout-top">
                      <div className="preview-callout-icon">
                        <Terminal size={18} />
                      </div>
                      <div className="preview-callout-titles">
                        <strong>Deterministic Evidence Preview</strong>
                        <span>Evaluated locally via immutable policy rules • Zero LLM calls</span>
                      </div>
                    </div>
                    <p className="preview-callout-desc">
                      This audit was computed instantaneously using client-side deterministic policy tables. To watch the Google ADK Agent run all four evidence tools and inspect live AI reasoning, switch to Agent Mode.
                    </p>
                    <button
                      type="button"
                      className="preview-switch-action"
                      onClick={() => runAudit('agent')}
                      disabled={busy}
                    >
                      <Sparkles size={14} />
                      <span>Run with Real Google ADK Agent →</span>
                    </button>
                  </div>
                ) : (
                  /* Real Google ADK Tool Calling Sequence */
                  <>
                    <div className="agent-meta-header">
                      <div className="model-citation-badge">
                        <Cpu size={14} />
                        <span>Model: {audit.agent_review?.model || 'gemini-3.5-flash-lite'}</span>
                      </div>
                      <span style={{ fontSize: '10px', color: '#94a3b8' }}>
                        Session: InMemorySessionService
                      </span>
                    </div>

                    {/* 2. Interactive Evidence Source Inspection Box (Issue 2) */}
                    {inspectingSource && (
                      <div className="evidence-inspector-card" role="region" aria-label="Evidence Record Inspection">
                        <div className="inspector-card-header">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Code2 size={13} style={{ color: '#38bdf8' }} />
                            <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#f8fafc' }}>
                              Citation: {inspectingSource}
                            </strong>
                            {inspectedRecord && (
                              <span className={`project-nav-badge ${
                                inspectedRecord.status === 'passed' || inspectedRecord.status === 'complete' || inspectedRecord.status === 'approved' ? 'success' :
                                inspectedRecord.status === 'failed' || inspectedRecord.status === 'rejected' ? 'danger' : 'warning'
                              }`}>
                                {inspectedRecord.status}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setInspectingSource(null)}
                            className="btn-secondary"
                            style={{ height: '22px', padding: '0 6px', fontSize: '10px' }}
                            aria-label="Close evidence inspector"
                          >
                            <X size={12} />
                          </button>
                        </div>
                        {inspectedRecord ? (
                          <div className="inspector-card-body">
                            <div className="inspector-field">
                              <span className="inspector-field-label">Requirement:</span>
                              <span className="inspector-field-value">{inspectedRecord.requirementTitle}</span>
                            </div>
                            <div className="inspector-field">
                              <span className="inspector-field-label">Verified Record Detail:</span>
                              <p className="inspector-detail-quote">&ldquo;{inspectedRecord.detail || 'Verified record registered on file.'}&rdquo;</p>
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                            Citation registered in Google ADK agent response.
                          </div>
                        )}
                      </div>
                    )}

                    <div className="timeline-step-list">
                      {audit.agent_review?.execution_trace && audit.agent_review.execution_trace.length > 0 ? (
                        audit.agent_review.execution_trace.map(step => (
                          <div key={step.order} className={`timeline-card-item ${step.status}`}>
                            <div className="step-marker-badge">
                              {step.order}
                            </div>
                            <div className="step-content-card">
                              <div className="step-header-row">
                                <div className="step-tool-signature">
                                  <strong>{step.title}</strong>
                                  <span>{step.tool}()</span>
                                </div>
                                <span className={`project-nav-badge ${
                                  step.status === 'verified' ? 'success' :
                                  step.status === 'blocked' ? 'danger' :
                                  step.status === 'error' ? 'danger' :
                                  step.status === 'warning' ? 'warning' : 'muted'
                                }`}>
                                  {step.status === 'verified' ? 'Verified' :
                                   step.status === 'blocked' ? 'Blocked' :
                                   step.status === 'error' ? 'Source Outage' :
                                   step.status === 'warning' ? 'Pending' : 'Empty'}
                                </span>
                              </div>

                              <p className="step-detail-message">{step.detail}</p>

                              {/* Interactive Accessible Source Pills */}
                              {step.source_ids && step.source_ids.length > 0 && (
                                <div className="step-sources-strip">
                                  {step.source_ids.map(sid => (
                                    <button
                                      type="button"
                                      key={sid}
                                      className={`source-ref-pill ${inspectingSource === sid ? 'active' : ''}`}
                                      onClick={() => handleInspectSource(sid)}
                                      aria-label={`Inspect evidence details for citation ${sid}`}
                                      aria-pressed={inspectingSource === sid}
                                    >
                                      <Code2 size={10} />
                                      <span>{sid}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div style={{ fontSize: '11px', color: '#64748b', padding: '12px' }}>
                          No execution trace logged for this agent run.
                        </div>
                      )}
                    </div>

                    {/* Agent Verified Commentary Box */}
                    <div className="agent-synthesis-box">
                      <div className="synthesis-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Sparkles size={14} />
                          <span>Agent Synthesis (Citing Sources)</span>
                        </div>
                        <span className="synthesis-badge">Ground Truth Checked</span>
                      </div>
                      <p className="synthesis-text">
                        {audit.agent_review?.summary || audit.agent_review?.warning || 'No narrative generated.'}
                      </p>
                    </div>

                    {/* Remediation & Next Actions */}
                    <div className="next-actions-container">
                      <span className="actions-header-title">Prioritized Next Actions</span>
                      {audit.next_actions.map((act, i) => (
                        <div key={i} className="action-item-row">
                          <span className="action-number-dot">{i + 1}</span>
                          <span>{act}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>

          {/* 4. MANDATORY HUMAN GOVERNANCE BAR */}
          <footer className="human-signoff-bar">
            <div className="human-signoff-left">
              <Lock size={15} style={{ color: '#34d399' }} />
              <div>
                <strong>Mandatory Human Gate:</strong> Automated agents audit delivery criteria, but final milestone and financial release requires formal human stakeholder authorization.
              </div>
            </div>
            <div className="human-signoff-badge">
              Deterministic Safety Authority
            </div>
          </footer>
        </main>
      </div>
    </div>
  )
}
