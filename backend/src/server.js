import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { initDb, q } from './db.js';
import { startRunFromCard } from './orchestrator.js';

initDb();
const app = express();
app.use(cors());
app.use(express.json());
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try { req.user = jwt.verify(token, JWT_SECRET); next(); } catch { res.status(401).json({ error: 'unauthorized' }); }
}

const crud = (table) => ({
  list: (req, res) => res.json({ items: q.all(`SELECT * FROM ${table} ORDER BY id DESC`) }),
  get: (req, res) => res.json({ item: q.one(`SELECT * FROM ${table} WHERE id=?`, Number(req.params.id)) }),
  create: (req, res) => {
    const body = req.body || {};
    const keys = Object.keys(body);
    const vals = Object.values(body);
    const cols = keys.join(',');
    const ph = keys.map(() => '?').join(',');
    const t = q.now();
    const withTimes = [...vals, t, t];
    q.run(`INSERT INTO ${table}(${cols}${cols ? ',' : ''}createdAt,updatedAt) VALUES(${ph}${ph ? ',' : ''}?,?)`, ...withTimes);
    res.status(201).json({ ok: true });
  },
  update: (req, res) => {
    const body = req.body || {};
    const keys = Object.keys(body);
    const set = keys.map((k) => `${k}=?`).join(',');
    q.run(`UPDATE ${table} SET ${set}${set ? ',' : ''}updatedAt=? WHERE id=?`, ...Object.values(body), q.now(), Number(req.params.id));
    res.json({ ok: true });
  },
  del: (req, res) => { q.run(`DELETE FROM ${table} WHERE id=?`, Number(req.params.id)); res.json({ ok: true }); }
});

app.post('/api/auth/register', async (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string().min(6), name: z.string().min(1) });
  const p = schema.parse(req.body);
  const hash = await bcrypt.hash(p.password, 10);
  q.run('INSERT INTO users(email,passwordHash,name,createdAt) VALUES(?,?,?,?)', p.email, hash, p.name, q.now());
  res.status(201).json({ ok: true });
});

app.post('/api/auth/login', async (req, res) => {
  const p = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
  const u = q.one('SELECT * FROM users WHERE email=?', p.email);
  if (!u || !(await bcrypt.compare(p.password, u.passwordHash))) return res.status(401).json({ error: 'invalid credentials' });
  res.json({ token: jwt.sign({ id: u.id, email: u.email, name: u.name }, JWT_SECRET, { expiresIn: '7d' }) });
});

app.use('/api', auth);

const resources = {
  companies: crud('companies'),
  sites: crud('sites'),
  teams: crud('teams'),
  projects: crud('projects'),
  agents: crud('agents'),
  llmProviders: crud('llm_provider_configs')
};

for (const [k, r] of Object.entries(resources)) {
  app.get(`/api/${k}`, r.list);
  app.get(`/api/${k}/:id`, r.get);
  app.post(`/api/${k}`, r.create);
  app.put(`/api/${k}/:id`, r.update);
  app.delete(`/api/${k}/:id`, r.del);
}

app.put('/api/agents/:id/prompt', (req, res) => {
  q.run('UPDATE agents SET promptTemplate=?, updatedAt=? WHERE id=?', req.body.promptTemplate || '', q.now(), Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/projects/:projectId/boards', (req, res) => {
  res.json({ items: q.all('SELECT * FROM boards WHERE projectId=? ORDER BY id', Number(req.params.projectId)) });
});
app.post('/api/projects/:projectId/boards', (req, res) => {
  const t = q.now();
  const name = req.body.name || 'Main Board';
  const r = q.run('INSERT INTO boards(projectId,name,createdAt,updatedAt) VALUES(?,?,?,?)', Number(req.params.projectId), name, t, t);
  const boardId = r.lastInsertRowid;
  ['Backlog','In Progress','Review','Done'].forEach((n, idx) => q.run('INSERT INTO columns_board(boardId,name,idx,createdAt,updatedAt) VALUES(?,?,?,?,?)', boardId, n, idx, t, t));
  res.status(201).json({ boardId });
});

app.get('/api/boards/:boardId/columns', (req, res) => {
  const boardId = Number(req.params.boardId);
  const columns = q.all('SELECT * FROM columns_board WHERE boardId=? ORDER BY idx', boardId).map((c) => ({
    ...c,
    cards: q.all('SELECT * FROM cards WHERE columnId=? ORDER BY id DESC', c.id)
  }));
  res.json({ columns });
});
app.post('/api/boards/:boardId/columns', (req, res) => {
  const boardId = Number(req.params.boardId);
  const idx = req.body.idx ?? q.one('SELECT COALESCE(MAX(idx),-1)+1 n FROM columns_board WHERE boardId=?', boardId).n;
  q.run('INSERT INTO columns_board(boardId,name,idx,createdAt,updatedAt) VALUES(?,?,?,?,?)', boardId, req.body.name, idx, q.now(), q.now());
  res.status(201).json({ ok: true });
});
app.put('/api/columns/:columnId', (req, res) => {
  q.run('UPDATE columns_board SET name=?, idx=?, updatedAt=? WHERE id=?', req.body.name, req.body.idx, q.now(), Number(req.params.columnId));
  res.json({ ok: true });
});

app.post('/api/columns/:columnId/cards', (req, res) => {
  const columnId = Number(req.params.columnId);
  const col = q.one('SELECT * FROM columns_board WHERE id=?', columnId);
  const b = req.body;
  q.run(`INSERT INTO cards(boardId,columnId,title,description,priority,type,labels,dueDate,storyPoints,createdBy,githubRepoUrl,githubBranch,createdAt,updatedAt)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, col.boardId, columnId, b.title, b.description || '', b.priority || 'MEDIUM', b.type || 'FEATURE', JSON.stringify(b.labels || []), b.dueDate || null, b.storyPoints || null, req.user.id, b.githubRepoUrl || null, b.githubBranch || null, q.now(), q.now());
  res.status(201).json({ ok: true });
});
app.put('/api/cards/:cardId', (req, res) => {
  const b = req.body;
  q.run('UPDATE cards SET title=?,description=?,priority=?,type=?,labels=?,dueDate=?,storyPoints=?,columnId=?,updatedAt=? WHERE id=?', b.title, b.description, b.priority, b.type, JSON.stringify(b.labels || []), b.dueDate || null, b.storyPoints || null, b.columnId, q.now(), Number(req.params.cardId));
  res.json({ ok: true });
});
app.delete('/api/cards/:cardId', (req, res) => { q.run('DELETE FROM cards WHERE id=?', Number(req.params.cardId)); res.json({ ok: true }); });
app.post('/api/cards/:cardId/comments', (req, res) => {
  q.run('INSERT INTO card_comments(cardId,authorId,body,createdAt) VALUES(?,?,?,?)', Number(req.params.cardId), req.user.id, req.body.body, q.now());
  res.status(201).json({ ok: true });
});
app.get('/api/cards/:cardId/comments', (req, res) => res.json({ items: q.all('SELECT * FROM card_comments WHERE cardId=? ORDER BY id DESC', Number(req.params.cardId)) }));
app.post('/api/cards/:cardId/assignees', (req, res) => {
  q.run('INSERT INTO card_assignees(cardId,agentId,createdAt) VALUES(?,?,?)', Number(req.params.cardId), Number(req.body.agentId), q.now());
  res.status(201).json({ ok: true });
});

app.post('/api/cards/:cardId/run', async (req, res) => {
  const run = await startRunFromCard({ cardId: Number(req.params.cardId), provider: req.body.provider, model: req.body.model });
  res.status(201).json({ run });
});
app.get('/api/runs/:id/status', (req, res) => res.json({ run: q.one('SELECT * FROM runs WHERE id=?', Number(req.params.id)) }));
app.get('/api/runs/:id/messages', (req, res) => res.json({ items: q.all('SELECT * FROM message_logs WHERE runId=? ORDER BY id', Number(req.params.id)) }));
app.get('/api/runs/:id/artifacts', (req, res) => res.json({ items: q.all('SELECT * FROM artifacts WHERE runId=? ORDER BY id', Number(req.params.id)) }));

app.post('/api/projects/:id/github/verify', (req, res) => res.json({ ok: true, message: 'scaffold: repo connection verification pending provider wiring' }));
app.get('/api/projects/:id/github/branches', (req, res) => res.json({ branches: ['main', 'develop'] }));
app.post('/api/projects/:id/github/create-pr', (req, res) => res.json({ ok: true, prUrl: 'https://github.com/example/repo/pull/1' }));

const port = process.env.PORT || 4600;
app.listen(port, () => console.log(`AI Company backend running on http://localhost:${port}`));
