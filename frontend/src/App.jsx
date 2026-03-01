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
  const [note, setNote] = useState('');
  const [selectedRun, setSelectedRun] = useState(null);
  const [runMessages, setRunMessages] = useState([]);
  const [runArtifacts, setRunArtifacts] = useState([]);

  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [forceOnboarding, setForceOnboarding] = useState(false);
  const [onboardCompany, setOnboardCompany] = useState('');
  const [onboardSite, setOnboardSite] = useState('');
  const [onboardRegion, setOnboardRegion] = useState('APAC');
  const [onboardTeam, setOnboardTeam] = useState('');
  const [onboardProject, setOnboardProject] = useState('');
  const [onboardingStep, setOnboardingStep] = useState(1);

  useEffect(() => { bootstrap(); }, []);
  useEffect(() => { if (projectId) loadBoards(projectId); }, [projectId]);
  useEffect(() => { if (boardId) loadColumns(boardId); }, [boardId]);

  async function bootstrap() {
    await api.post('/auth/register', { email: 'admin@example.com', password: 'password123', name: 'Admin' }).catch(()=>{});
    const login = await api.post('/auth/login', { email: 'admin@example.com', password: 'password123' });
    api.defaults.headers.common.Authorization = `Bearer ${login.data.token}`;

    const companies = await api.get('/companies');
    const sites = await api.get('/sites');
    const teams = await api.get('/teams');
    const projectsRes = await api.get('/projects');

    if (!companies.data.items.length || !sites.data.items.length || !teams.data.items.length || !projectsRes.data.items.length) {
      setNeedsOnboarding(true);
      return;
    }

    setProjects(projectsRes.data.items);
    setProjectId(projectsRes.data.items[0]?.id || null);
    setAgents((await api.get('/agents')).data.items || []);
  }

  async function completeOnboarding() {
    if (!onboardCompany || !onboardSite || !onboardTeam || !onboardProject) {
      setNote('Please fill company, site, team and project names');
      return;
    }

    await api.post('/companies', { name: onboardCompany });
    const companies = await api.get('/companies');
    const companyId = companies.data.items[0].id;

    await api.post('/sites', { companyId, name: onboardSite, region: onboardRegion });
    const sites = await api.get('/sites');
    const siteId = sites.data.items[0].id;

    await api.post('/teams', { siteId, name: onboardTeam });
    const teams = await api.get('/teams');
    const teamId = teams.data.items[0].id;

    await api.post('/projects', { teamId, name: onboardProject, description: 'Onboarded project', defaultBranch: 'main' });
    const projectsRes = await api.get('/projects');
    setProjects(projectsRes.data.items);
    setProjectId(projectsRes.data.items[0]?.id || null);

    const a = await api.get('/agents');
    if (!a.data.items.length) {
      await api.post('/agents', { teamId, name: 'PM Agent', role: 'PM' });
      await api.post('/agents', { teamId, name: 'Dev Agent', role: 'DEV' });
      await api.post('/agents', { teamId, name: 'QA Agent', role: 'QA' });
      await api.post('/agents', { teamId, name: 'Ops Agent', role: 'OPS' });
    }
    setAgents((await api.get('/agents')).data.items || []);
    setNeedsOnboarding(false);
    setForceOnboarding(false);
    setOnboardingStep(1);
    setNote('Company onboarding completed');
  }

  async function loadBoards(pid) {
    let b = await api.get(`/projects/${pid}/boards`);
    if (!b.data.items.length) {
      await api.post(`/projects/${pid}/boards`, { name: 'Execution Board' });
      b = await api.get(`/projects/${pid}/boards`);
    }

    const primaryBoardId = b.data.items[0]?.id || null;
    if (primaryBoardId) {
      const cols = await api.get(`/boards/${primaryBoardId}/columns`);
      if (!(cols.data.columns || []).length) {
        await api.post(`/boards/${primaryBoardId}/columns`, { name: 'Backlog', idx: 0 });
        await api.post(`/boards/${primaryBoardId}/columns`, { name: 'In Progress', idx: 1 });
        await api.post(`/boards/${primaryBoardId}/columns`, { name: 'Review', idx: 2 });
        await api.post(`/boards/${primaryBoardId}/columns`, { name: 'Done', idx: 3 });
      }
    }

    setBoards(b.data.items);
    setBoardId(primaryBoardId);
  }

  async function loadColumns(bid) {
    const c = await api.get(`/boards/${bid}/columns`);
    const cols = (c.data.columns || []).map(col => ({ ...col, cards: col.cards || [] }));
    setColumns(cols);

    const hasCards = cols.some((col) => (col.cards || []).length > 0);
    if (!hasCards && cols[0]) {
      await api.post(`/columns/${cols[0].id}/cards`, { title: 'Sample: Build first feature', description: 'Seed card', priority: 'MEDIUM', type: 'FEATURE' });
      const cc = await api.get(`/boards/${bid}/columns`);
      setColumns((cc.data.columns || []).map(col => ({ ...col, cards: col.cards || [] })));
    }
  }

  async function addCard() {
    try {
      const text = title.trim();
      if (!text) {
        setNote('Please enter a task title first');
        return;
      }

      // self-heal: ensure board + columns are available before adding card
      if (!boardId && projectId) {
        await loadBoards(projectId);
      }
      if (!columns.length && boardId) {
        await loadColumns(boardId);
      }
      if (!columns.length && projectId) {
        await loadBoards(projectId);
        const b = await api.get(`/projects/${projectId}/boards`);
        const bid = b.data.items?.[0]?.id;
        if (bid) {
          setBoardId(bid);
          await loadColumns(bid);
        }
      }

      if (!columns.length) {
        setNote('Could not load board columns automatically. Please click Refresh.');
        return;
      }

      const targetCol = columns.find((c) => String(c.name).toLowerCase() === 'backlog') || columns[0];
      const created = await api.post(`/columns/${targetCol.id}/cards`, {
        title: text,
        description: text,
        priority: 'MEDIUM',
        type: 'FEATURE'
      });
      const cardId = created?.data?.cardId;
      setTitle('');
      setNote(`Task added to ${targetCol.name}${cardId ? ' and picked by agents' : ''}`);
      await loadColumns(boardId || targetCol.board_id || targetCol.boardId);

      // auto-pick by agents after creating card
      if (cardId) {
        await runCard(cardId);
        await loadColumns(boardId || targetCol.board_id || targetCol.boardId);
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to add task';
      setNote(`Add Task failed: ${msg}`);
    }
  }

  async function runCard(cardId) {
    const r = await api.post(`/cards/${cardId}/runs`, { provider: 'openai', model: 'openai-codex/gpt-5.3-codex' });
    const run = await api.get(`/runs/${r.data.runId}`);
    setRuns((prev) => [run.data.item, ...prev]);
    setNote(`Run ${r.data.runId} completed`);
    setTab('runs');
  }

  async function moveCard(cardId, targetColumnId) {
    await api.post(`/cards/${cardId}/move`, { targetColumnId, position: 0 });
    await loadColumns(boardId);
  }

  async function deleteCard(cardId) {
    await api.delete(`/cards/${cardId}`);
    setNote(`Card ${cardId} deleted`);
    await loadColumns(boardId);
  }

  async function addColumn() {
    if (!boardId) return;
    const name = prompt('Column name?');
    if (!name) return;
    await api.post(`/boards/${boardId}/columns`, { name, idx: columns.length });
    await loadColumns(boardId);
  }

  async function openRun(runId) {
    const run = await api.get(`/runs/${runId}`);
    const msgs = await api.get(`/runs/${runId}/messages`);
    const arts = await api.get(`/runs/${runId}/artifacts`);
    setSelectedRun(run.data.item);
    setRunMessages(msgs.data.items || []);
    setRunArtifacts(arts.data.items || []);
  }

  if (needsOnboarding || forceOnboarding) {
    return <div className='shell'>
      <aside className='sidebar'>
        <h2>AI Company</h2>
        <div className='tree'>
          <div>Company onboarding required</div>
        </div>
      </aside>
      <section className='main'>
        <div className='panel'>
          <h3>Company Onboarding</h3>
          <p>Create your company workspace step-by-step.</p>
          {forceOnboarding && !needsOnboarding && <button onClick={()=>{setForceOnboarding(false); setOnboardingStep(1);}}>← Back to Workspace</button>}

          <div className='steps'>
            <span className={onboardingStep===1?'active':''}>1. Company</span>
            <span className={onboardingStep===2?'active':''}>2. Site</span>
            <span className={onboardingStep===3?'active':''}>3. Team</span>
            <span className={onboardingStep===4?'active':''}>4. Project</span>
          </div>

          <div className='onboard-grid'>
            {onboardingStep === 1 && (
              <>
                <input placeholder='Company name' value={onboardCompany} onChange={e=>setOnboardCompany(e.target.value)} />
                <button onClick={()=> onboardCompany ? setOnboardingStep(2) : setNote('Company name is required')}>Next: Site</button>
              </>
            )}

            {onboardingStep === 2 && (
              <>
                <input placeholder='Site name' value={onboardSite} onChange={e=>setOnboardSite(e.target.value)} />
                <input placeholder='Region' value={onboardRegion} onChange={e=>setOnboardRegion(e.target.value)} />
                <div className='step-actions'>
                  <button onClick={()=>setOnboardingStep(1)}>Back</button>
                  <button onClick={()=> onboardSite ? setOnboardingStep(3) : setNote('Site name is required')}>Next: Team</button>
                </div>
              </>
            )}

            {onboardingStep === 3 && (
              <>
                <input placeholder='Team name' value={onboardTeam} onChange={e=>setOnboardTeam(e.target.value)} />
                <div className='step-actions'>
                  <button onClick={()=>setOnboardingStep(2)}>Back</button>
                  <button onClick={()=> onboardTeam ? setOnboardingStep(4) : setNote('Team name is required')}>Next: Project</button>
                </div>
              </>
            )}

            {onboardingStep === 4 && (
              <>
                <input placeholder='Project name' value={onboardProject} onChange={e=>setOnboardProject(e.target.value)} />
                <div className='step-actions'>
                  <button onClick={()=>setOnboardingStep(3)}>Back</button>
                  <button onClick={completeOnboarding}>Create Company Workspace</button>
                </div>
              </>
            )}
          </div>

          {note && <div className='row'>{note}</div>}
        </div>
      </section>
    </div>;
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
          <button disabled style={{opacity:1,cursor:'default'}}>Auto Executor: ON</button>
          <button onClick={()=>setTab('kanban')} className={tab==='kanban'?'active':''}>Kanban Board</button>
          <button onClick={()=>setTab('agents')} className={tab==='agents'?'active':''}>Agents</button>
          <button onClick={()=>setTab('runs')} className={tab==='runs'?'active':''}>Runs</button>
          <button onClick={()=>setTab('github')} className={tab==='github'?'active':''}>GitHub</button>
          <button onClick={()=>setForceOnboarding(true)}>Company Onboarding</button>
          <button onClick={async()=>{ const r = await api.post('/admin/restart-services'); setNote(r.data.message || 'Restart triggered'); }}>Restart Services</button>
        </div>
      </header>
      {note && <div className='row'>{note}</div>}

      {tab==='kanban' && <div className='kanban'>
        {columns.map((col, colIdx) => <div key={col.id} className='col'>
          <h4>{col.name}</h4>
          <div className='cards'>
            {col.cards?.map(card => <div className='card' key={card.id}>
              <b>{card.title}</b>
              <small>{card.priority} · {card.type}</small>
              <div className='moves'>
                <button onClick={()=>deleteCard(card.id)}>Delete</button>
              </div>
            </div>)}
          </div>
        </div>)}
        <div className='bottomBar'>
          <input value={title} onChange={e=>setTitle(e.target.value)} placeholder='Add card from bottom input...' />
          <button onClick={addCard}>Add Task</button>
        </div>
      </div>}

      {tab==='agents' && <div className='panel'>{agents.map(a => <div key={a.id} className='row'>{a.name} · {a.role} · {a.status}</div>)}</div>}
      {tab==='runs' && <div className='panel'>
        {runs.map(r => <div key={r.id} className='row'>
          Run #{r.id} · {r.status} · {r.provider}/{r.model}
          <button onClick={()=>openRun(r.id)} style={{marginLeft:8}}>Open</button>
        </div>)}
        {selectedRun && <div className='panel'>
          <b>Run #{selectedRun.id} details</b>
          <div className='row'>Messages: {runMessages.length}</div>
          {runMessages.map(m => <div key={m.id} className='row'>{m.agent_role}: {m.content}</div>)}
          <div className='row'>Artifacts: {runArtifacts.length}</div>
          {runArtifacts.map(a => <div key={a.id} className='row'>{a.kind}: {a.title}</div>)}
        </div>}
      </div>}
      {tab==='github' && <div className='panel'>
        <button onClick={()=>api.post(`/projects/${projectId}/github/connect`,{repoUrl:'https://github.com/example/repo',branch:'main',tokenRef:'GITHUB_TOKEN'}).then(()=>setNote('Repo connected (scaffold)'))}>Connect Repo</button>
        <button onClick={()=>api.get(`/projects/${projectId}/github/status`).then(r=>setNote(`GitHub status: ${r.data.connected ? 'connected' : 'not connected'}`))}>Check Status</button>
        <button onClick={()=>api.get(`/projects/${projectId}/github/branches`).then(r=>setNote(`Branches: ${r.data.branches.join(', ')}`))}>List Branches</button>
        <button onClick={()=>runs[0] && api.post(`/runs/${runs[0].id}/github/create-pr`).then(r=>setNote(`PR: ${r.data.prUrl}`))}>Create PR (latest run)</button>
      </div>}
    </section>
  </div>;
}
