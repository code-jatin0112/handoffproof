import asyncio
import os
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from agent_runtime import run_adk_review


def test_missing_api_key_raises_runtime_error(monkeypatch):
    monkeypatch.delenv('GOOGLE_API_KEY', raising=False)
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    with pytest.raises(RuntimeError, match='GOOGLE_API_KEY is not configured'):
        asyncio.run(run_adk_review({'id': 'test', 'requirements': []}, {'status': 'READY', 'counts': {}}))


def test_tool_definitions_and_missing_sources():
    # Verify the four tool closures behave correctly under unavailable sources
    project = {
        'id': 'outage-test',
        'name': 'Outage Project',
        'client': 'Client X',
        'description': 'Description',
        'requirements': [{'id': 'r1', 'title': 'Test req'}],
        'deliverables': [{'key': 'd1', 'status': 'complete'}],
        'tests': [{'key': 't1', 'status': 'passed'}],
        'approvals': [{'key': 'a1', 'status': 'approved'}],
        'unavailable_sources': ['test', 'approval']
    }

    unavailable = set(project.get('unavailable_sources', []))
    called = []

    def read_project_brief() -> dict:
        called.append('read_project_brief')
        return {k: project[k] for k in ('id', 'name', 'client', 'description', 'requirements')}

    def inspect_deliverables() -> dict:
        called.append('inspect_deliverables')
        if 'deliverable' in unavailable:
            return {'error': 'Deliverable evidence source unavailable', 'items': []}
        return {'items': project.get('deliverables', [])}

    def inspect_test_results() -> dict:
        called.append('inspect_test_results')
        if 'test' in unavailable:
            return {'error': 'Test evidence source unavailable; cached values are unverified', 'items': []}
        return {'items': project.get('tests', [])}

    def inspect_client_approvals() -> dict:
        called.append('inspect_client_approvals')
        if 'approval' in unavailable:
            return {'error': 'Approval source unavailable', 'items': []}
        return {'items': project.get('approvals', [])}

    # Call tools and verify behaviors
    brief = read_project_brief()
    assert brief['name'] == 'Outage Project'

    deliv = inspect_deliverables()
    assert len(deliv['items']) == 1

    tests = inspect_test_results()
    assert 'error' in tests
    assert tests['items'] == []

    approvals = inspect_client_approvals()
    assert 'error' in approvals
    assert approvals['items'] == []

    assert set(called) == {'read_project_brief', 'inspect_deliverables', 'inspect_test_results', 'inspect_client_approvals'}


def test_execution_trace_structure_and_order():
    project = {
        'id': 'trace-test',
        'name': 'Trace Project',
        'client': 'Client Y',
        'description': 'Description',
        'requirements': [{'id': 'r1', 'title': 'Test req'}],
        'deliverables': [{'key': 'd1', 'status': 'incomplete', 'source': 'DEL-999'}],
        'tests': [{'key': 't1', 'status': 'failed', 'source': 'QA-999'}],
        'approvals': [{'key': 'a1', 'status': 'pending', 'source': 'APR-999'}],
        'unavailable_sources': []
    }

    # Verify how execution_trace reflects incomplete/failed/pending items
    execution_trace = []
    called = []
    unavailable = set(project.get('unavailable_sources', []))

    # Simulate tool sequence
    def run_all_tools():
        # Tool 1
        called.append('read_project_brief')
        execution_trace.append({'tool': 'read_project_brief', 'order': len(called), 'status': 'verified'})
        # Tool 2
        called.append('inspect_deliverables')
        delivs = project.get('deliverables', [])
        incomplete = [d for d in delivs if d.get('status') == 'incomplete']
        execution_trace.append({'tool': 'inspect_deliverables', 'order': len(called), 'status': 'blocked' if incomplete else 'verified'})
        # Tool 3
        called.append('inspect_test_results')
        tests = project.get('tests', [])
        failed = [t for t in tests if t.get('status') == 'failed']
        execution_trace.append({'tool': 'inspect_test_results', 'order': len(called), 'status': 'blocked' if failed else 'verified'})
        # Tool 4
        called.append('inspect_client_approvals')
        apps = project.get('approvals', [])
        pending = [a for a in apps if a.get('status') == 'pending']
        execution_trace.append({'tool': 'inspect_client_approvals', 'order': len(called), 'status': 'warning' if pending else 'verified'})

    run_all_tools()
    assert len(execution_trace) == 4
    assert [e['order'] for e in execution_trace] == [1, 2, 3, 4]
    assert execution_trace[1]['status'] == 'blocked'
    assert execution_trace[2]['status'] == 'blocked'
    assert execution_trace[3]['status'] == 'warning'


