import { useEffect, useState } from 'react';
import axios from 'axios';

const api = axios.create({ baseURL: 'http://localhost:4600/api' });

export default function App() {
  const [tab, setTab] = useState('kanban');
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [boards, setBoards] = useState([]);
  const [boardId, setBoardId] = useState(null);
  const [columns, setColumns] = useState([]);
  const [agents, setAgents] = useState([]);
  const [runs, setRuns] = useState([]);
  const [title, setTitle] = useState('');

  useEffect(() => { bootstrap(); }, []);
  useEffect(() => { if (projectId) loadBoards(projectId); }, [projectId]);
  useEffect(() => { if (boardId) loadColumns(boardId); }, [boardId]);

  async function bootstrap() {
    await api.post('/auth/register', { email: 'admin@example.com', password: 'password123', name: 'Admin' }).catch(()=>{});
    const login = await api.post('/auth/login', { email: 'admin@example.com', password: 'password123' });
    api.defaults.headers.common.Authorization = `Bearer ${login.data.token}`;

    const c = await api.get('/companies');
    if (!c.data.items.length) await api.post('/companies', { name: 'AI Company' });
    const companies = await api.get('/companies');
    const companyId = companies.data.items[0].id;

    const s = await api.get('/sites');
    if (!s.data.items.length) await api.post('/sites', { companyId, name: 'India', region: 'APAC' });
    const sites = await api.get('/sites');
    const siteId = sites.data.items[0].id;

    const t = await api.get('/teams');
    if (!t.data.items.length) await api.post('/teams', { siteId, name: 'Core Team' });
    const teams = await api.get('/teams');
    const teamId = teams.data.items[0].id;

    const p = await api.get('/projects');
    if (!p.data.items.length) await api.post('/projects', { teamId, name: 'AI Platform', description: 'Main project', defaultBranch: 'main' });
    const pp = await api.get('/projects');
    setProjects(pp.data.items); setProjectId(pp.data.items[0]?.id || null);

    const a = await api.get('/agents');
    if (!a.data.items.length) {
      await api.post('/agents', { teamId, name: 'PM Agent', role: 'PM' });
      await api.post('/agents', { teamId, name: 'Dev Agent', role: 'DEV' });
      await api.post('/agents', { teamId, name: 'QA Agent', role: 'QA' });
      await api.post('/agents', { teamId, name: 'Ops Agent', role: 'OPS' });
    }
    setAgents((await api.get('/agents')).data.items);
  }

  async function loadBoards(pid) {
    let b = await api.get(`/projects/${pid}/boards`);
    if (!b.data.items.length) {
      await api.post(`/projects/${pid}/boards`, { name: 'Execution Board' });
      b = await api.get(`/projects/${pid}/boards`);
    }
    setBoards(b.data.items); setBoardId(b.data.items[0]?.id || null);
  }

  async function loadColumns(bid) {
    const c = await api.get(`/boards/${bid}/columns`);
    const withCards = await Promise.all(c.data.columns.map(async col => ({ ...col, cards: (await api.get(`/boards/${bid}/columns`)).data.columns.find(x=>x.id===col.id)?.cards || [] })));
    // API currently returns only columns; quick fetch cards via SQL fallback endpoint not present, so keep empty list scaffold:
    setColumns(withCards.map(x => ({...x, cards: x.cards || []})));
  }

  async function addCard() {
    if (!title.trim() || !columns[0]) return;
    await api.post(`/columns/${columns[0].id}/cards`, { title, description: title, priority: 'MEDIUM', type: 'FEATURE' });
    setTitle('');
    await loadColumns(boardId);
  }

  async function runCard(cardId) {
    const r = await api.post(`/cards/${cardId}/runs`, { provider: 'openai', model: 'gpt-4o-mini' });
    const run = await api.get(`/runs/${r.data.runId}`);
    setRuns((prev) => [run.data.item, ...prev]);
    setTab('runs');
  }

  return <div className='shell'>
    <aside className='sidebar'>
      <h2>AI Company</h2>
      <div className='tree'>
        <div>Company → Sites → Teams → Projects</div>
        {projects.map(p => <button key={p.id} className={p.id===projectId?'active':''} onClick={()=>setProjectId(p.id)}>{p.name}</button>)}
      </div>
    </aside>

    <section className='main'>
      <header className='topbar'>
        <input placeholder='Search...' />
        <div className='tabs'>
          <button onClick={()=>setTab('kanban')} className={tab==='kanban'?'active':''}>Kanban Board</button>
          <button onClick={()=>setTab('agents')} className={tab==='agents'?'active':''}>Agents</button>
          <button onClick={()=>setTab('runs')} className={tab==='runs'?'active':''}>Runs</button>
          <button onClick={()=>setTab('github')} className={tab==='github'?'active':''}>GitHub</button>
        </div>
      </header>

      {tab==='kanban' && <div className='kanban'>
        {columns.map(col => <div key={col.id} className='col'>
          <h4>{col.name}</h4>
          <div className='cards'>
            {col.cards?.map(card => <div className='card' key={card.id}>
              <b>{card.title}</b>
              <small>{card.priority} · {card.type}</small>
              <button onClick={()=>runCard(card.id)}>Run with Agents</button>
            </div>)}
          </div>
        </div>)}
        <div className='bottomBar'>
          <input value={title} onChange={e=>setTitle(e.target.value)} placeholder='Add card from bottom input...' />
          <button onClick={addCard}>Add Task</button>
        </div>
      </div>}

      {tab==='agents' && <div className='panel'>{agents.map(a => <div key={a.id} className='row'>{a.name} · {a.role} · {a.status}</div>)}</div>}
      {tab==='runs' && <div className='panel'>{runs.map(r => <div key={r.id} className='row'>Run #{r.id} · {r.status} · {r.provider}/{r.model}</div>)}</div>}
      {tab==='github' && <div className='panel'>
        <button onClick={()=>api.post(`/projects/${projectId}/github/connect`,{repoUrl:'https://github.com/example/repo',branch:'main',tokenRef:'GITHUB_TOKEN'}).then(()=>alert('Connected (scaffold)'))}>Connect Repo</button>
        <button onClick={()=>api.get(`/projects/${projectId}/github/branches`).then(r=>alert(r.data.branches.join(', ')))}>List Branches</button>
      </div>}
    </section>
  </div>;
}
