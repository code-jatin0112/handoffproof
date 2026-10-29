import json
import sys
from copy import deepcopy
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from audit import audit_project

DATA = {p['id']:p for p in json.loads((Path(__file__).resolve().parents[1]/'data/projects.json').read_text())}

@pytest.mark.parametrize('project_id,expected', [
    ('storefront','BLOCKED'), ('ready','READY'), ('missing','NEEDS_REVIEW'),
    ('conflicting','NEEDS_REVIEW'), ('outage','NEEDS_REVIEW')
])
def test_seed_cases(project_id, expected):
    assert audit_project(DATA[project_id])['status'] == expected


def test_all_ready():
    result = audit_project(DATA['ready'])
    assert result['counts']['VERIFIED'] == result['total'] == 3


def test_failed_test_blocks():
    assert next(r for r in audit_project(DATA['storefront'])['requirements'] if r['id']=='checkout')['status'] == 'BLOCKED'


def test_missing_is_not_success():
    result = audit_project(DATA['missing'])
    assert result['counts']['UNVERIFIED'] == 2
    assert result['counts']['VERIFIED'] == 1


def test_conflicting_evidence_needs_review():
    assert audit_project(DATA['conflicting'])['counts']['CONFLICT'] == 1


def test_outage_overrides_cached_pass():
    result = audit_project(DATA['outage'])
    assert result['counts']['UNVERIFIED'] == 1


def test_no_requirements_empty_is_currently_ready_but_does_not_evaluate():
    p = deepcopy(DATA['ready']); p['requirements'] = []
    result = audit_project(p)
    # With zero listed acceptance criteria, no evidence-backed readiness certification is possible.
    assert result['total'] == 0
    assert result['status'] == 'NEEDS_REVIEW'


def test_rejected_approval_blocks():
    p = deepcopy(DATA['ready']); p['approvals'][0]['status'] = 'rejected'
    assert audit_project(p)['status'] == 'BLOCKED'


def test_pending_approval_review():
    p = deepcopy(DATA['ready']); p['approvals'][0]['status'] = 'pending'
    assert audit_project(p)['status'] == 'NEEDS_REVIEW'


def test_unknown_evidence_state():
    p = deepcopy(DATA['ready']); p['tests'][0]['status'] = 'queued'
    assert audit_project(p)['status'] == 'NEEDS_REVIEW'


def test_conflicting_deliverables():
    p = deepcopy(DATA['ready']); p['deliverables'].append(dict(p['deliverables'][0], status='incomplete',source='DEL-202'))
    assert audit_project(p)['counts']['CONFLICT'] == 1


def test_only_noncritical_failed_is_still_blocked():
    p = deepcopy(DATA['ready']); p['requirements'][0]['critical'] = False; p['deliverables'][0]['status'] = 'incomplete'
    assert audit_project(p)['status'] == 'BLOCKED'


def test_next_actions_for_blockers():
    result = audit_project(DATA['storefront'])
    assert len(result['next_actions']) == len(result['blockers']) == 2


def test_results_do_not_mutate_seed():
    orig = deepcopy(DATA['ready'])
    audit_project(DATA['ready'])
    assert DATA['ready'] == orig


def test_unavailable_approval_source():
    p = deepcopy(DATA['ready']); p['unavailable_sources'] = ['approval']
    assert audit_project(p)['status'] == 'NEEDS_REVIEW'


def test_nonexistent_evidence_key():
    p = deepcopy(DATA['ready']); p['requirements'][0]['key'] = 'not-found'
    assert audit_project(p)['counts']['UNVERIFIED'] == 1
