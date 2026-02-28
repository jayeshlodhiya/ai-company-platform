# AI Company Platform (Spring Boot + React)

Implements an AI company workspace with hierarchy:
**Company → Sites → Teams → Projects**
plus Kanban execution, multi-agent run scaffolding, LLM provider abstraction, and GitHub integration scaffolds.

## Generated folders
- `backend/` Spring Boot app
- `frontend/` React + Vite app
- `docker-compose.yml`
- `.env.example`

## Run PostgreSQL
```bash
docker compose up -d postgres
```

## Run Backend (Spring Boot)
```bash
cd backend
mvn spring-boot:run
```
Backend: `http://localhost:4600`

## Run Frontend (React)
```bash
cd frontend
npm install
npm run dev
```
Frontend: `http://localhost:5173` (or next free port)

## Configure OpenAI + Ollama
- Copy `.env.example` values into your shell/env management.
- OpenAI key should be stored securely and referenced by provider config.
- Ollama base URL defaults to `http://localhost:11434`.

## GitHub token (placeholder vault)
- Use `tokenRef` fields (e.g., `GITHUB_TOKEN`) in GitHub connect endpoints.
- Real secret retrieval should be handled by your vault service integration.

## API highlights
- Auth: `/api/auth/register`, `/api/auth/login`
- Hierarchy CRUD: `/api/companies`, `/api/sites`, `/api/teams`, `/api/projects`
- Agents: `/api/agents`, `/api/agents/{id}/prompt`
- Kanban: `/api/projects/{projectId}/boards`, `/api/boards/{boardId}/columns`, `/api/columns/{columnId}/cards`, `/api/cards/{cardId}/move`, `/api/boards/{boardId}/columns/reorder`
- Runs: `/api/cards/{cardId}/runs`, `/api/runs/{runId}`, `/api/runs/{runId}/messages`, `/api/runs/{runId}/artifacts`
- LLM: `/api/llm/providers`, `/api/llm/models?provider=...`, `/api/llm/invoke`
- GitHub scaffold: `/api/projects/{projectId}/github/connect`, `/api/projects/{projectId}/github/status`, `/api/projects/{projectId}/github/branches`, `/api/runs/{runId}/github/create-pr`

## Notes
- Kanban drag-and-drop + SSE/WebSocket are scaffold-ready and can be extended next.
- Flyway migrations seed initial company/site/team/project/board/columns/agents.
