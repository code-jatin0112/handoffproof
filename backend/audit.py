"""Deterministic evidence policy; the LLM cannot override these decisions."""
from copy import deepcopy
from typing import Any

PASS = {'deliverable': 'complete', 'test': 'passed', 'approval': 'approved'}
FAIL = {'deliverable': 'incomplete', 'test': 'failed', 'approval': 'rejected'}
COLLECTION = {'deliverable': 'deliverables', 'test': 'tests', 'approval': 'approvals'}


def audit_project(project: dict[str, Any]) -> dict[str, Any]:
    """Evaluate source records; never mistake absent evidence for a pass."""
    project = deepcopy(project)
    results = []
    unavailable = set(project.get('unavailable_sources', []))
    for req in project['requirements']:
        kind = req['kind']
        if kind not in COLLECTION:
            matches, status = [], 'UNVERIFIED'
            reason = 'Unsupported evidence category.'
        elif kind in unavailable:
            matches, status = [], 'UNVERIFIED'
            reason = 'Evidence source unavailable. Cannot verify this requirement.'
        else:
            matches = [item for item in project.get(COLLECTION[kind], []) if item.get('key') == req['key']]
            statuses = {item.get('status') for item in matches}
            if not matches:
                status, reason = 'UNVERIFIED', 'No matching evidence found.'
            elif len(statuses) > 1 or len(matches) > 1:
                status, reason = 'CONFLICT', 'Multiple evidence records require human reconciliation.'
            elif statuses == {PASS[kind]}:
                status, reason = 'VERIFIED', 'Evidence meets the requirement.'
            elif statuses == {FAIL[kind]} or statuses == {'pending'}:
                status = 'BLOCKED' if statuses == {FAIL[kind]} else 'UNVERIFIED'
                reason = 'Recorded evidence shows an incomplete or failed requirement.' if status == 'BLOCKED' else 'Approval is still pending.'
            else:
                status, reason = 'UNVERIFIED', 'Unknown or non-final evidence status.'
        results.append({
            'id': req['id'], 'title': req['title'], 'kind': kind,
            'critical': req.get('critical', True), 'status': status,
            'reason': reason,
            'evidence': [{'source': row.get('source', 'Unknown'), 'status': row.get('status', 'unknown'), 'detail': row.get('detail','')} for row in matches],
        })
    count = {s: sum(r['status'] == s for r in results) for s in ['VERIFIED', 'BLOCKED', 'UNVERIFIED', 'CONFLICT']}
    if not results:
        status = 'NEEDS_REVIEW'
    elif count['BLOCKED']:
        status = 'BLOCKED'
    elif count['UNVERIFIED'] or count['CONFLICT']:
        status = 'NEEDS_REVIEW'
    else:
        status = 'READY'
    blockers = [r for r in results if r['status'] != 'VERIFIED']
    next_actions = []
    for row in blockers:
        action = {
            'BLOCKED': 'Resolve failed or incomplete evidence and rerun verification',
            'UNVERIFIED': 'Obtain verifiable evidence or clarify current status',
            'CONFLICT': 'Reconcile conflicting sources with a human reviewer'
        }[row['status']]
        next_actions.append(f"{row['title']}: {action}.")
    if not next_actions:
        next_actions.append('Prepare final handoff package and retain evidence links.')
    summary = {
        'READY': 'All listed requirements have supporting, non-conflicting evidence.',
        'BLOCKED': 'One or more requirements have explicit failure or incomplete evidence.',
        'NEEDS_REVIEW': 'No confirmed failure, but evidence is missing, unavailable or conflicting.'
    }[status]
    return {
        'project_id': project['id'], 'project_name': project['name'],
        'client': project['client'], 'status': status, 'summary': summary,
        'counts': count, 'total': len(results), 'requirements': results,
        'blockers': blockers, 'next_actions': next_actions,
        'policy': 'Conservative evidence-based policy: missing evidence never counts as passed.',
    }
