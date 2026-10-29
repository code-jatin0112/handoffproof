"""HandoffProof API: read-only simulated professional workflows."""
import json
import logging
import os
import re
import sys
import traceback
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv

# Ensure backend directory is in sys.path so sibling imports work regardless of working directory
BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Ensure backend/.env or root .env is loaded before reading environment variables
env_file = BACKEND_DIR / '.env'
if env_file.exists():
    load_dotenv(dotenv_path=env_file)
load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from audit import audit_project
from agent_runtime import run_adk_review

logger = logging.getLogger('handoffproof')
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')


def sanitize_secrets(text: str) -> str:
    """Mask API keys or tokens in logs."""
    if not text:
        return text
    for key_name in ('GOOGLE_API_KEY', 'GEMINI_API_KEY'):
        val = os.getenv(key_name)
        if val and len(val) > 4:
            text = text.replace(val, '[REDACTED_API_KEY]')
    text = re.sub(r'AIza[0-9A-Za-z-_]{35}', '[REDACTED_API_KEY]', text)
    text = re.sub(r'AQ\.[A-Za-z0-9_-]{20,}', '[REDACTED_API_KEY]', text)
    text = re.sub(r'(key|api_key|x-goog-api-key)=([^\s&]+)', r'\1=[REDACTED]', text, flags=re.IGNORECASE)
    return text


DATA_FILE = Path(__file__).parent / 'data' / 'projects.json'
PROJECTS = {p['id']: p for p in json.loads(DATA_FILE.read_text())}
app = FastAPI(title='HandoffProof API', version='0.1.0')

# CORS configuration supporting development and production deployments
raw_cors = os.getenv('CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000,*')
origins = [o.strip() for o in raw_cors.split(',') if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=['GET', 'POST'],
    allow_headers=['Content-Type']
)

# Mount built React assets if available so FastAPI can serve both dashboards as a single service
FRONTEND_DIST = Path(__file__).resolve().parent.parent / 'frontend' / 'dist'
if (FRONTEND_DIST / 'assets').exists():
    from fastapi.staticfiles import StaticFiles
    app.mount('/assets', StaticFiles(directory=str(FRONTEND_DIST / 'assets')), name='assets')


class AuditRequest(BaseModel):
    project_id: str
    mode: Literal['preview', 'agent'] = 'preview'


@app.get('/', response_class=HTMLResponse)
def bundled_demo():
    # Bundled standalone demo: zero-dependency fallback for judging
    return (Path(__file__).parent / 'demo.html').read_text(encoding='utf-8')


@app.get('/app', response_class=HTMLResponse)
@app.get('/dashboard', response_class=HTMLResponse)
def react_dashboard():
    # Production React dashboard served directly from FastAPI
    if (FRONTEND_DIST / 'index.html').exists():
        return (FRONTEND_DIST / 'index.html').read_text(encoding='utf-8')
    return (Path(__file__).parent / 'demo.html').read_text(encoding='utf-8')


@app.get('/demo', response_class=HTMLResponse)
def demo_page():
    return (Path(__file__).parent / 'demo.html').read_text(encoding='utf-8')


@app.get('/api/health')
def health():
    has_key = bool(os.getenv('GOOGLE_API_KEY') or os.getenv('GEMINI_API_KEY'))
    model_name = os.getenv('GEMINI_MODEL', 'gemini-2.5-flash')
    return {
        'ok': True,
        'agent_configured': has_key,
        'model': model_name,
        'project_count': len(PROJECTS)
    }


@app.get('/api/projects')
def projects():
    return [{'id': p['id'], 'name': p['name'], 'client': p['client'], 'owner': p['owner'], 'target_date': p['target_date'], 'description': p['description']} for p in PROJECTS.values()]


@app.get('/api/projects/{project_id}')
def project_detail(project_id: str):
    if project_id not in PROJECTS:
        raise HTTPException(404, 'Project not found')
    return PROJECTS[project_id]


@app.post('/api/audit')
async def audit(request: AuditRequest):
    if request.project_id not in PROJECTS:
        raise HTTPException(404, 'Project not found')
    project = PROJECTS[request.project_id]
    result = audit_project(project)
    result['mode'] = request.mode
    result['agent_review'] = None
    if request.mode == 'agent':
        try:
            agent_review = await run_adk_review(project, result)
        except Exception as exc:
            tb = traceback.format_exc()
            clean_tb = sanitize_secrets(tb)
            logger.error(f"ADK agent execution failed for project '{request.project_id}':\n{clean_tb}")
            # Avoid leaking model errors or secrets to the UI.
            raise HTTPException(status_code=503, detail=f'ADK agent unavailable: {type(exc).__name__}. Check API key, model, network and backend logs.') from exc
        result['agent_review'] = agent_review
        if not agent_review['complete']:
            # Preserve the evidence-policy decision but clearly mark the AI tool run incomplete.
            # The UI must not represent this as a successful agent audit.
            result['agent_review']['warning'] = 'Agent invocation incomplete; do not rely on its narrative. Manual review of tool execution needed.'
    return result


if __name__ == '__main__':
    import uvicorn
    port = int(os.getenv('PORT', 8000))
    host = os.getenv('HOST', '0.0.0.0')
    uvicorn.run('main:app', host=host, port=port, reload=False)

