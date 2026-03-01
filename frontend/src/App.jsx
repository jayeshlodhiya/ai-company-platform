import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const api = axios.create({ baseURL: 'http://localhost:4600/api' });

const AGENT_FACE = {
  PM: '🧠',
  DEV: '👨‍💻',
  QA: '🕵️',
  OPS: '🚀',
  SECURITY: '🛡️'
};
const PLATFORM_ADMIN_EMAIL = 'admin@example.com';

export default function App() {
  const [tab, setTab] = useState('kanban');
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [sites, setSites] = useState([]);
  const [teams, setTeams] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState(null);
  const [selectedSiteId, setSelectedSiteId] = useState(null);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteRegion, setNewSiteRegion] = useState('APAC');
  const [newTeamName, setNewTeamName] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
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

  const uniqueColumns = useMemo(() => {
    const seen = new Set();
    return (columns || []).filter((c) => {
      const k = String(c.name || '').toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [columns]);

  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [forceOnboarding, setForceOnboarding] = useState(false);
  const [onboardCompany, setOnboardCompany] = useState('');
  const [onboardSite, setOnboardSite] = useState('');
  const [onboardRegion, setOnboardRegion] = useState('APAC');
  const [onboardTeam, setOnboardTeam] = useState('');
  const [onboardProject, setOnboardProject] = useState('');
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [requiresLogin, setRequiresLogin] = useState(!localStorage.getItem('ai_company_token'));
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('password123');
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('ai_company_token');
    const savedRole = localStorage.getItem('ai_company_role');
    if (saved) {
      api.defaults.headers.common.Authorization = `Bearer ${saved}`;
      setIsPlatformAdmin(savedRole === 'platform_admin');
      setRequiresLogin(false);
    }
  }, []);

  useEffect(() => { if (!requiresLogin) bootstrap(); }, [requiresLogin]);
  useEffect(() => { if (projectId) loadBoards(projectId); }, [projectId]);
  useEffect(() => { if (boardId) loadColumns(boardId); }, [boardId]);

  async function bootstrap() {
    const companiesRes = await api.get('/companies');
    const sitesRes = await api.get('/sites');
    const teamsRes = await api.get('/teams');
    const projectsRes = await api.get('/projects');

    setCompanies(companiesRes.data.items || []);
    setSites(sitesRes.data.items || []);
    setTeams(teamsRes.data.items || []);

    if (!companiesRes.data.items.length || !sitesRes.data.items.length || !teamsRes.data.items.length || !projectsRes.data.items.length) {
      setNeedsOnboarding(true);
      return;
    }

    const cId = companiesRes.data.items[0].id;
    const siteRows = (sitesRes.data.items || []).filter((s) => s.company_id === cId || s.companyId === cId);
    const sId = siteRows[0]?.id;
    const teamRows = (teamsRes.data.items || []).filter((t) => t.site_id === sId || t.siteId === sId);
    const tId = teamRows[0]?.id;
    const projectRows = (projectsRes.data.items || []).filter((p) => p.team_id === tId || p.teamId === tId);

    setSelectedCompanyId(cId);
    setSelectedSiteId(sId || null);
    setSelectedTeamId(tId || null);
    setProjects(projectsRes.data.items);
    setProjectId((projectRows[0] || projectsRes.data.items[0])?.id || null);
    setAgents((await api.get('/agents')).data.items || []);
  }

  async function refreshHierarchy() {
    const companiesRes = await api.get('/companies');
    const sitesRes = await api.get('/sites');
    const teamsRes = await api.get('/teams');
    const projectsRes = await api.get('/projects');
    setCompanies(companiesRes.data.items || []);
    setSites(sitesRes.data.items || []);
    setTeams(teamsRes.data.items || []);
    setProjects(projectsRes.data.items || []);
  }

  async function createCompanyQuick() {
    if (!isPlatformAdmin) {
      setNote('Only Platform Admin can create companies');
      return;
    }
    if (!newCompanyName.trim()) return;
    await api.post('/companies', { name: newCompanyName.trim() });
    setNewCompanyName('');
    await refreshHierarchy();
  }

  async function createSiteQuick() {
    if (!selectedCompanyId || !newSiteName.trim()) return;
    await api.post('/sites', { companyId: selectedCompanyId, name: newSiteName.trim(), region: newSiteRegion || 'APAC' });
    setNewSiteName('');
    await refreshHierarchy();
  }

  async function createTeamQuick() {
    if (!selectedSiteId || !newTeamName.trim()) return;
    await api.post('/teams', { siteId: selectedSiteId, name: newTeamName.trim() });
    setNewTeamName('');
    await refreshHierarchy();
  }

  async function createProjectQuick() {
    if (!selectedTeamId || !newProjectName.trim()) return;
    await api.post('/projects', { teamId: selectedTeamId, name: newProjectName.trim(), description: 'Created from hierarchy', defaultBranch: 'main' });
    setNewProjectName('');
    await refreshHierarchy();
  }

  async function loginCompany() {
    try {
      await api.post('/auth/register', { email, password, name: 'Company Admin' }).catch(()=>{});
      const login = await api.post('/auth/login', { email, password });
      api.defaults.headers.common.Authorization = `Bearer ${login.data.token}`;
      localStorage.setItem('ai_company_token', login.data.token);
      const platform = email.trim().toLowerCase() === PLATFORM_ADMIN_EMAIL;
      localStorage.setItem('ai_company_role', platform ? 'platform_admin' : 'company_admin');
      setIsPlatformAdmin(platform);
      setRequiresLogin(false);
      setNote(platform ? 'Logged in as Platform Admin' : 'Logged in as Company Admin');
    } catch (e) {
      setNote('Login failed');
    }
  }

  function logoutCompany() {
    localStorage.removeItem('ai_company_token');
    localStorage.removeItem('ai_company_role');
    delete api.defaults.headers.common.Authorization;
    setIsPlatformAdmin(false);
    setRequiresLogin(true);
    setNote('Logged out');
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
    const companiesRes = await api.get('/companies');
    const sitesRes = await api.get('/sites');
    const teamsRes = await api.get('/teams');
    setCompanies(companiesRes.data.items || []);
    setSites(sitesRes.data.items || []);
    setTeams(teamsRes.data.items || []);
    setSelectedCompanyId(companyId);
    setSelectedSiteId(siteId);
    setSelectedTeamId(teamId);
    setProjects(projectsRes.data.items);
    setProjectId(projectsRes.data.items.find((p)=> (p.team_id===teamId || p.teamId===teamId))?.id || null);

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
      if (!uniqueColumns.length && boardId) {
        await loadColumns(boardId);
      }
      if (!uniqueColumns.length && projectId) {
        await loadBoards(projectId);
        const b = await api.get(`/projects/${projectId}/boards`);
        const bid = b.data.items?.[0]?.id;
        if (bid) {
          setBoardId(bid);
          await loadColumns(bid);
        }
      }

      if (!uniqueColumns.length) {
        setNote('Could not load board columns automatically. Please click Refresh.');
        return;
      }

      const targetCol = uniqueColumns.find((c) => String(c.name).toLowerCase() === 'backlog') || uniqueColumns[0];
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
    setNote('Run started... moving across stages');
    const r = await api.post(`/cards/${cardId}/runs`, { provider: 'openai', model: 'openai-codex/gpt-5.3-codex' });
    const run = await api.get(`/runs/${r.data.runId}`);
    setRuns((prev) => [run.data.item, ...prev]);

    // Stay on Kanban and refresh columns over time instead of forcing full page reload.
    for (let i = 0; i < 4; i++) {
      await new Promise((res) => setTimeout(res, 3200));
      await loadColumns(boardId);
    }

    setNote(`Run ${r.data.runId} completed`);
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

  if (requiresLogin) {
    return <div className='shell'>
      <aside className='sidebar'><h2>AI Company</h2></aside>
      <section className='main'>
        <div className='panel onboard-grid'>
          <h3>Company Login</h3>
          <div className='row'>Platform Admin email: <b>{PLATFORM_ADMIN_EMAIL}</b></div>
          <input placeholder='Company admin email' value={email} onChange={e=>setEmail(e.target.value)} />
          <input type='password' placeholder='Password' value={password} onChange={e=>setPassword(e.target.value)} />
          <button onClick={loginCompany}>Login</button>
          {note && <div className='row'>{note}</div>}
        </div>
      </section>
    </div>;
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

          <div className='panel'>
            <h4>Settings: Quick Create</h4>
            <div className='row'>{isPlatformAdmin ? 'Platform Admin: full access' : 'Company Admin: sites, teams, projects'}</div>

            {isPlatformAdmin && (
              <div className='hCreate'>
                <input placeholder='New company' value={newCompanyName} onChange={e=>setNewCompanyName(e.target.value)} />
                <button onClick={createCompanyQuick}>Add Company</button>
              </div>
            )}

            <div className='hCreate'>
              <input placeholder='New site' value={newSiteName} onChange={e=>setNewSiteName(e.target.value)} />
              <input placeholder='Region' value={newSiteRegion} onChange={e=>setNewSiteRegion(e.target.value)} />
              <button onClick={createSiteQuick}>Add Site</button>
            </div>
            <div className='hCreate'>
              <input placeholder='New team' value={newTeamName} onChange={e=>setNewTeamName(e.target.value)} />
              <button onClick={createTeamQuick}>Add Team</button>
            </div>
            <div className='hCreate'>
              <input placeholder='New project' value={newProjectName} onChange={e=>setNewProjectName(e.target.value)} />
              <button onClick={createProjectQuick}>Add Project</button>
            </div>
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
        <div>Company Workspace</div>
        <div className='row'>Use hierarchy tiles in main area to navigate Company → Site → Team → Project.</div>

      </div>
    </aside>

    <section className='main'>
      <header className='topbar'>
        <div className='crumb'>
          {companies.find(c=>c.id===selectedCompanyId)?.name || 'Company'} › {sites.find(s=>s.id===selectedSiteId)?.name || 'Site'} › {teams.find(t=>t.id===selectedTeamId)?.name || 'Team'} › {projects.find(p=>p.id===projectId)?.name || 'Project'}
        </div>
        <input placeholder='Search...' />
        <div className='tabs'>
          <button disabled style={{opacity:1,cursor:'default'}}>Auto Executor: ON</button>
          <button onClick={()=>setTab('kanban')} className={tab==='kanban'?'active':''}>Kanban Board</button>
          <button onClick={()=>setTab('agents')} className={tab==='agents'?'active':''}>Agents</button>
          <button onClick={()=>setTab('github')} className={tab==='github'?'active':''}>GitHub</button>
          <button onClick={()=>setForceOnboarding(true)}>Company Onboarding</button>
          <button onClick={logoutCompany}>Logout</button>
        </div>
      </header>
      {note && <div className='row'>{note}</div>}

      <div className='hierarchyTiles'>
        <div className='tileCol'>
          <h4>Companies</h4>
          {(companies || []).map(c => (
            <button key={c.id} className={`tileBtn ${c.id===selectedCompanyId?'active':''}`} onClick={()=>{
              setSelectedCompanyId(c.id);
              const siteRows = (sites||[]).filter(s => (s.company_id===c.id || s.companyId===c.id));
              const sId = siteRows[0]?.id || null;
              setSelectedSiteId(sId);
              const teamRows = (teams||[]).filter(t => (t.site_id===sId || t.siteId===sId));
              const tId = teamRows[0]?.id || null;
              setSelectedTeamId(tId);
              const pRows = (projects||[]).filter(p => (p.team_id===tId || p.teamId===tId));
              if (pRows[0]) setProjectId(pRows[0].id);
            }}>{c.name}</button>
          ))}
        </div>
        <div className='tileCol'>
          <h4>Sites</h4>
          {(sites || []).filter(s => !selectedCompanyId || s.company_id===selectedCompanyId || s.companyId===selectedCompanyId).map(s => (
            <button key={s.id} className={`tileBtn ${s.id===selectedSiteId?'active':''}`} onClick={()=>{
              setSelectedSiteId(s.id);
              const teamRows = (teams||[]).filter(t => (t.site_id===s.id || t.siteId===s.id));
              const tId = teamRows[0]?.id || null;
              setSelectedTeamId(tId);
              const pRows = (projects||[]).filter(p => (p.team_id===tId || p.teamId===tId));
              if (pRows[0]) setProjectId(pRows[0].id);
            }}>{s.name}</button>
          ))}
        </div>
        <div className='tileCol'>
          <h4>Teams</h4>
          {(teams || []).filter(t => !selectedSiteId || t.site_id===selectedSiteId || t.siteId===selectedSiteId).map(t => (
            <button key={t.id} className={`tileBtn ${t.id===selectedTeamId?'active':''}`} onClick={()=>{
              setSelectedTeamId(t.id);
              const pRows = (projects||[]).filter(p => (p.team_id===t.id || p.teamId===t.id));
              if (pRows[0]) setProjectId(pRows[0].id);
            }}>{t.name}</button>
          ))}
        </div>
        <div className='tileCol'>
          <h4>Projects</h4>
          {projects.filter(p => !selectedTeamId || p.team_id===selectedTeamId || p.teamId===selectedTeamId).map(p => (
            <button key={p.id} className={`tileBtn ${p.id===projectId?'active':''}`} onClick={()=>setProjectId(p.id)}>{p.name}</button>
          ))}
        </div>
      </div>

      {tab==='kanban' && <div className='kanban'>
        {uniqueColumns.map((col, colIdx) => <div key={col.id} className='col'>
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

      {tab==='agents' && <div className='panel'>
        <h3>Agent Team Workspace</h3>
        <div className='agentGrid'>
          {agents.map(a => (
            <div key={a.id} className={`agentCard ${String(a.status || '').toUpperCase() === 'ACTIVE' ? 'active' : ''}`}>
              <div className='agentFace'>{AGENT_FACE[String(a.role || '').toUpperCase()] || '🤖'}</div>
              <div>
                <b>{a.name}</b>
                <div className='muted'>{a.role} · {a.status}</div>
              </div>
            </div>
          ))}
          {agents.length === 0 && <div className='row'>No agents yet.</div>}
        </div>
      </div>}
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
