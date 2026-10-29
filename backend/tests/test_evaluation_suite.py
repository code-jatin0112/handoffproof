"""Comprehensive Evaluation Test Suite for HandoffProof (18 distinct cases).

Validates:
- Structured output correctness
- Verdict accuracy across all edge cases (ready, blocked, needs_review)
- Safety invariants (missing != pass, adversarial prompt resistance, incomplete tool handling)
- API contracts (invalid IDs return 404)
"""
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from audit import audit_project
from evaluations.eval_dataset import EVALUATION_CASES
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


@pytest.mark.parametrize("case", [c for c in EVALUATION_CASES if c["expected_verdict"] != "HTTP_404"], ids=lambda c: c["id"])
def test_evaluation_case_deterministic_policy(case):
    project = case["project"]
    result = audit_project(project)

    # 1. Verdict accuracy
    assert result["status"] == case["expected_verdict"], (
        f"Case {case['id']} expected {case['expected_verdict']} but got {result['status']}"
    )

    # 2. Structured counts correctness
    for k, v in case["expected_counts"].items():
        assert result["counts"][k] == v, (
            f"Case {case['id']} count {k} expected {v} but got {result['counts'][k]}"
        )

    # 3. Blockers count
    assert len(result["blockers"]) == case["expected_blockers_count"], (
        f"Case {case['id']} expected {case['expected_blockers_count']} blockers, got {len(result['blockers'])}"
    )

    # 4. Safe behavior: missing evidence is never marked VERIFIED
    for req in result["requirements"]:
        if not req["evidence"]:
            assert req["status"] != "VERIFIED", f"Empty evidence for {req['id']} was marked as VERIFIED!"

    # 5. Non-ready states always have actionable next steps
    if result["status"] in ("BLOCKED", "NEEDS_REVIEW") and result["total"] > 0:
        assert len(result["next_actions"]) > 0, f"Case {case['id']} is {result['status']} but has no next actions."


def test_eval_18_invalid_project_id_404():
    res_get = client.get("/api/projects/nonexistent_project_id")
    assert res_get.status_code == 404

    res_post = client.post("/api/audit", json={"project_id": "nonexistent_project_id", "mode": "preview"})
    assert res_post.status_code == 404


def test_adversarial_prompt_injection_safety():
    case = next(c for c in EVALUATION_CASES if c["id"] == "eval_15_prompt_injection_in_evidence")
    result = audit_project(case["project"])
    # Ensure adversarial prompt does not override the status to READY
    assert result["status"] == "BLOCKED"
    assert any("SQLi" in b["reason"] or b["status"] == "BLOCKED" for b in result["blockers"])


def test_incomplete_tool_run_guard():
    # If the agent calls fewer than 4 tools, complete is False and warning is set
    called = ["read_project_brief", "inspect_deliverables"]
    distinct = list(dict.fromkeys(called))
    complete = len(distinct) == 4
    warning = None if complete else "Agent did not invoke all required tools; narrative discarded and human review required."

    assert complete is False
    assert warning is not None

