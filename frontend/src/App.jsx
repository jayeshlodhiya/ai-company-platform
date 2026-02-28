import { useEffect, useState } from 'react';
import axios from 'axios';

const api = axios.create({ baseURL: 'http://localhost:4600/api' });

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('password123');
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [boards, setBoards] = useState([]);
  const [columns, setColumns] = useState([]);
  const [taskText, setTaskText] = useState('');

  useEffect(() => { if (token) api.defaults.headers.common.Authorization = `Bearer ${token}`; }, [token]);
  useEffect(() => { if (token) loadProjects(); }, [token]);
  useEffect(() => { if (selectedProjectId) loadBoards(selectedProjectId); }, [selectedProjectId]);

  async function ensureAuth() {
    try {
      const r = await api.post('/auth/login', { email, password });
      setToken(r.data.token); localStorage.setItem('token', r.data.token);
    } catch {
      await api.post('/auth/register', { email, password, name: 'Admin' });
      const r = await api.post('/auth/login', { email, password });
      setToken(r.data.token); localStorage.setItem('token', r.data.token);
    }
  }

  async function seedHierarchy() {
    const c = await api.post('/companies', { name: 'AI Company' });
    const companies = await api.get('/companies');
    const companyId = companies.data.items[0].id;
    await api.post('/sites', { companyId, name: 'India', region: 'APAC' });
    const sites = await api.get('/sites');
    const siteId = sites.data.items[0].id;
    await api.post('/teams', { siteId, name: 'Core Team' });
    const teams = await api.get('/teams');
    const teamId = teams.data.items[0].id;
    await api.post('/projects', { teamId, name: 'Platform Revamp', description: 'Default project' });
    await loadProjects();
  }

  async function loadProjects() {
    const r = await api.get('/projects');
    setProjects(r.data.items);
    if (!r.data.items.length) return;
    setSelectedProjectId((p) => p || r.data.items[0].id);
  }

  async function loadBoards(projectId) {
    const b = await api.get(`/projects/${projectId}/boards`);
    let boardId = b.data.items[0]?.id;
    if (!boardId) {
      await api.post(`/projects/${projectId}/boards`, { name: 'Execution Board' });
      const bb = await api.get(`/projects/${projectId}/boards`);
      boardId = bb.data.items[0]?.id;
      setBoards(bb.data.items);
    } else setBoards(b.data.items);
    if (!boardId) return;
    const c = await api.get(`/boards/${boardId}/columns`);
    setColumns(c.data.columns);
  }

  async function addCard() {
    if (!taskText.trim() || !columns.length) return;
    await api.post(`/columns/${columns[0].id}/cards`, {
      title: taskText,
      priority: 'MEDIUM',
      type: 'FEATURE',
      description: taskText
    });
    setTaskText('');
    await loadBoards(selectedProjectId);
  }

  async function moveCard(cardId, toColumnId) {
    const card = columns.flatMap(c => c.cards).find(c => c.id === cardId);
    if (!card) return;
    await api.put(`/cards/${cardId}`, { ...card, columnId: toColumnId, labels: [] });
    await loadBoards(selectedProjectId);
  }

  if (!token) {
    return <div className='auth'>
      <h2>AI Company Platform</h2>
      <p>Login/Register bootstrap</p>
      <input value={email} onChange={e => setEmail(e.target.value)} />
      <input value={password} onChange={e => setPassword(e.target.value)} type='password' />
      <button onClick={ensureAuth}>Continue</button>
    </div>;
  }

  return <div className='app'>
    <aside>
      <h3>Projects</h3>
      <button onClick={seedHierarchy}>Seed Base Data</button>
      {projects.map(p => <button key={p.id} className={p.id===selectedProjectId?'active':''} onClick={()=>setSelectedProjectId(p.id)}>{p.name}</button>)}
    </aside>

    <main>
      <h2>Kanban Execution</h2>
      <div className='board'>
        {columns.map(col => <section key={col.id}>
          <header>{col.name} <span>{col.cards.length}</span></header>
          <div className='cards'>
            {col.cards.map(card => <article key={card.id}>
              <b>{card.title}</b>
              <small>{card.priority} · {card.type}</small>
              <div className='moves'>
                {columns.filter(c => c.id!==col.id).map(c => <button key={c.id} onClick={()=>moveCard(card.id,c.id)}>Move → {c.name}</button>)}
                <button onClick={async()=>{ const r=await api.post(`/cards/${card.id}/run`,{provider:'openai',model:'gpt-4o-mini'}); alert(`Run ${r.data.run.id} started/completed`); }}>Run with Agents</button>
              </div>
            </article>)}
          </div>
        </section>)}
      </div>

      <div className='bottomInput'>
        <input value={taskText} onChange={e=>setTaskText(e.target.value)} placeholder='Add task from bottom input...' />
        <button onClick={addCard}>Add Task</button>
      </div>
    </main>
  </div>;
}
