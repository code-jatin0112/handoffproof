# HandoffProof — evidence-based project handoff auditing

**Track:** Google ADK Agent (Track 4). **Prototype:** October 2026 hackathon.

HandoffProof is a read-only project-handoff auditor for small agencies and B2B engineering teams. It asks a narrow, critical question: **Can we actually verify that this project is ready to be handed over?** It inspects acceptance requirements, delivered code, QA test runs and client signoff evidence. If any evidence is failed, absent, contradictory, or unavailable, it refuses to fabricate an approval.

---

## What the judges can see

- **Real agent with four actual read-only tools** (Google ADK): `read_project_brief`, `inspect_deliverables`, `inspect_test_results`, `inspect_client_approvals`.
- **Visual tool execution timeline** showing exact sequence (`#1` to `#4`), tool names, real source citations (`DEL-101`, `QA-224`, `APR-042`), and granular execution outcomes.
- **Deterministic verification policy** outside the LLM. Hallucinations or prompt injections inside evidence text cannot override the policy engine or mark a failing project ready.
- **Human signoff guard**: AI assistants and policies provide delivery intelligence; final deployment authorization strictly requires human stakeholder signoff.
- **Clear mode distinction**:
  - **Google ADK Agent**: Real tool calls via Google ADK (`gemini-2.5-flash` / `gemini-3.5-flash-lite`) providing verified narration and tool telemetry.
  - **Evidence Preview**: Offline deterministic rule evaluation without any LLM calls or API costs.
- **5 sample scenarios**:
  1. *NovaCommerce Storefront* — Blocked by failed QA (`QA-224`) and pending signoff (`APR-042`).
  2. *Atlas Agency Website* — All criteria verified ready for final human signoff.
  3. *Orbit Mobile Portal* — Missing test and signoff records (missing != pass).
  4. *Beacon CRM Migration* — Contradictory test records require human reconciliation.
  5. *Mercury API Handoff* — External test evidence source outage handled gracefully.
- **55 automated checks & 18 evaluation cases** covering edge cases, source outages, contradictory evidence, prompt injections, and invalid inputs.

---

## Setup & Running (macOS / Linux)

Requirements: Python 3.11+ (3.12 recommended), Node.js 20+, and a Google Gemini API key.

### 1. Backend API

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your GOOGLE_API_KEY. .env is automatically loaded by the server.
python -m uvicorn main:app --reload --port 8000
```

The API starts on **http://localhost:8000**. Health status can be checked at **http://localhost:8000/api/health**.

### 2. Frontend Dashboard

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** to load the React dashboard.

### 3. No-npm Fallback Demo

If Node.js is unavailable on the judging machine, opening **http://localhost:8000** serves a standalone bundled HTML demo with the full execution timeline and verdict display.

---

## Evaluation & Test Suites

We cleanly separate deterministic unit testing from live Google ADK model evaluation:

### 1. Full Automated Test Suite (55 tests)

```bash
cd backend
.venv/bin/python -m pytest -v
```

Tests API endpoints, policy engine invariants, mock ADK reviews, secret sanitization, and the 18 evaluation cases.

### 2. Deterministic Evaluation Suite (18 cases)

```bash
cd backend
.venv/bin/python evaluations/run_evaluation.py
```

Evaluates verdict correctness, structured counts, blocker tracking, and safety invariants across 18 edge cases offline.

### 3. Live Google ADK Agent Evaluation (Real Gemini Model)

```bash
cd backend
.venv/bin/python evaluations/run_evaluation.py --live
```

Executes live Google ADK agent runs across representative evaluation cases, validating genuine tool execution, latency, and source citation accuracy.

### 4. Frontend Production Build

```bash
cd frontend
npm run build
```

---

## Live Demo Sequence (2–3 Minutes for Judges)

Follow this sequence to showcase the system during judging:

1. **0:00–0:30 — Problem & Architecture:**
   - Explain that teams often claim "the project is ready," but scattered evidence disagrees.
   - Introduce HandoffProof's core philosophy: *evidence-first delivery intelligence* where the deterministic policy engine is the final authority, assisted by a Google ADK agent with 4 read-only tools.
2. **0:30–1:15 — Live Agent Execution (Negative Control - NovaCommerce):**
   - Select **Demo 1: NovaCommerce Storefront**.
   - Select **Google ADK agent** mode and click **Run Google ADK agent audit**.
   - Watch the **Execution Timeline** execute all four tools in real time:
     - `#1 read_project_brief()` -> Scope loaded.
     - `#2 inspect_deliverables()` -> Verified `DEL-101`, `DEL-108`.
     - `#3 inspect_test_results()` -> **Explicit Failure** detected on `QA-224` (card payment callback error).
     - `#4 inspect_client_approvals()` -> **Pending Signoff** on `APR-042`.
   - Point out the policy verdict: **HANDOFF BLOCKED** with explicit blockers and recommended remediation actions.
3. **1:15–1:45 — Positive Control (Atlas Agency):**
   - Select **Demo 2: Atlas Agency Website** and run the audit.
   - Show all 4 tools passing, status **READY**, and emphasize the **Human Sign-off Gate** notice.
4. **1:45–2:15 — Safety & Source Outages (Orbit & Mercury):**
   - Select **Demo 3: Orbit Mobile** to demonstrate that *missing evidence is never a pass*.
   - Select **Demo 5: Mercury API** to demonstrate how an external testing service outage revokes cached passes and marks requirements unverified.
5. **2:15–2:45 — Offline Preview vs Agent Mode:**
   - Switch to **Evidence preview** to demonstrate that teams can run deterministic evaluations offline without model costs or latency.
   - Click **Copy evidence report** to demonstrate one-click export with source traceability.

---

## Architecture

```text
React + Vite + TypeScript + Tailwind CSS (localhost:5173)
            |
            | POST /api/audit  {"project_id": "storefront", "mode": "agent"}
            v
       FastAPI Backend (localhost:8000)
            |
            +-- Deterministic Policy Engine (audit.py)
            |   |-- Evaluates contract criteria against immutable records
            |   +-- Authority on status: READY | BLOCKED | NEEDS_REVIEW
            |
            +-- Google ADK Agent Runtime (agent_runtime.py)
            |   |-- LlmAgent (gemini-2.5-flash / gemini-3.5-flash-lite)
            |   |-- Runner + InMemorySessionService
            |   +-- 4 Read-Only Evidence Tools:
            |         1. read_project_brief()
            |         2. inspect_deliverables()
            |         3. inspect_test_results()
            |         4. inspect_client_approvals()
            |
            +-- Evaluated Local Seed Data (5 Scenarios)
```

---

## Safety & Security Boundaries

- **Read-Only Tools**: Agent tools have zero write permissions. They cannot mutate repository state, create tickets, or self-approve handoffs.
- **Untrusted Evidence Data**: Text within evidence records is treated as untrusted data. Prompt injection attempts cannot override policy rules.
- **Secret Sanitization**: Stack traces and backend logs automatically redact Gemini API keys (`[REDACTED_API_KEY]`).
- **Git Protection**: `.env` and all virtual environment artifacts are strictly excluded via `.gitignore`.
- **Human Gate**: Final handoff release strictly requires authorized human stakeholder sign-off.
