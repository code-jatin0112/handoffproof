import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_health():
    assert client.get('/api/health').json()['ok'] is True


def test_projects():
    assert len(client.get('/api/projects').json()) == 5


def test_unknown_project():
    assert client.get('/api/projects/nope').status_code == 404


def test_preview_audit():
    out = client.post('/api/audit',json={'project_id':'storefront', 'mode':'preview'})
    assert out.status_code == 200
    assert out.json()['status'] == 'BLOCKED'
    assert out.json()['agent_review'] is None


def test_invalid_mode():
    assert client.post('/api/audit',json={'project_id':'ready','mode':'unsafe'}).status_code == 422


def test_unknown_audit_project():
    assert client.post('/api/audit',json={'project_id':'not-real'}).status_code == 404


def test_fallback_ui():
    response = client.get('/')
    assert response.status_code == 200
    assert 'handoffproof' in response.text.lower()


def test_react_dashboard_and_demo_routes():
    res_app = client.get('/app')
    assert res_app.status_code == 200
    assert 'handoffproof' in res_app.text.lower()

    res_demo = client.get('/demo')
    assert res_demo.status_code == 200
    assert 'handoffproof' in res_demo.text.lower()


def test_no_key_agent_fails_explicitly(monkeypatch):
    monkeypatch.delenv('GOOGLE_API_KEY', raising=False)
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    response = client.post('/api/audit',json={'project_id':'storefront','mode':'agent'})
    assert response.status_code == 503
    assert 'unavailable' in response.json()['detail']


def test_health_agent_configured_flag(monkeypatch):
    monkeypatch.setenv('GOOGLE_API_KEY', 'test-key')
    assert client.get('/api/health').json()['agent_configured'] is True

    monkeypatch.delenv('GOOGLE_API_KEY', raising=False)
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    assert client.get('/api/health').json()['agent_configured'] is False


def test_agent_audit_complete_mocked(monkeypatch):
    async def mock_review(project, result):
        return {
            'summary': 'All verified.',
            'tool_calls': ['read_project_brief', 'inspect_deliverables', 'inspect_test_results', 'inspect_client_approvals'],
            'tool_call_count': 4,
            'complete': True,
            'warning': None
        }
    monkeypatch.setattr('main.run_adk_review', mock_review)
    out = client.post('/api/audit', json={'project_id': 'ready', 'mode': 'agent'})
    assert out.status_code == 200
    res = out.json()
    assert res['status'] == 'READY'
    assert res['agent_review']['complete'] is True
    assert len(res['agent_review']['tool_calls']) == 4
    assert res['agent_review']['warning'] is None


def test_agent_audit_incomplete_warning(monkeypatch):
    async def mock_incomplete_review(project, result):
        return {
            'summary': '',
            'tool_calls': ['read_project_brief'],
            'tool_call_count': 1,
            'complete': False,
            'warning': 'Agent did not invoke all required tools; narrative discarded and human review required.'
        }
    monkeypatch.setattr('main.run_adk_review', mock_incomplete_review)
    out = client.post('/api/audit', json={'project_id': 'ready', 'mode': 'agent'})
    assert out.status_code == 200
    res = out.json()
    assert res['agent_review']['complete'] is False
    assert 'incomplete' in res['agent_review']['warning'].lower()


def test_sanitize_secrets_in_logs():
    from main import sanitize_secrets
    raw = 'Error calling https://generativelanguage.googleapis.com?key=AIzaSyDummyTestKeyForUnitTestingPurposes123 and secret AQ.DUMMYTESTSECRET1234567890'
    sanitized = sanitize_secrets(raw)
    assert 'AIza' not in sanitized
    assert 'AQ.' not in sanitized
    assert '[REDACTED' in sanitized

