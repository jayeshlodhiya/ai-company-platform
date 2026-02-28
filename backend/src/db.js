import Database from 'better-sqlite3';
import path from 'node:path';

const db = new Database(path.resolve(process.cwd(), 'ai-company.db'));
db.pragma('journal_mode = WAL');

function now() { return new Date().toISOString(); }

export function initDb() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE, passwordHash TEXT, name TEXT, createdAt TEXT);
  CREATE TABLE IF NOT EXISTS companies(id INTEGER PRIMARY KEY, name TEXT, createdAt TEXT, updatedAt TEXT);
  CREATE TABLE IF NOT EXISTS sites(id INTEGER PRIMARY KEY, companyId INTEGER, name TEXT, region TEXT, createdAt TEXT, updatedAt TEXT);
  CREATE TABLE IF NOT EXISTS teams(id INTEGER PRIMARY KEY, siteId INTEGER, name TEXT, createdAt TEXT, updatedAt TEXT);
  CREATE TABLE IF NOT EXISTS projects(id INTEGER PRIMARY KEY, teamId INTEGER, name TEXT, description TEXT, githubRepoUrl TEXT, defaultBranch TEXT, createdAt TEXT, updatedAt TEXT);

  CREATE TABLE IF NOT EXISTS llm_provider_configs(id INTEGER PRIMARY KEY, name TEXT, baseUrl TEXT, modelsJson TEXT, apiKeyRef TEXT, createdAt TEXT, updatedAt TEXT);
  CREATE TABLE IF NOT EXISTS github_links(id INTEGER PRIMARY KEY, projectId INTEGER, repoUrl TEXT, branch TEXT, tokenRef TEXT, webhookUrl TEXT, createdAt TEXT, updatedAt TEXT);

  CREATE TABLE IF NOT EXISTS agents(id INTEGER PRIMARY KEY, teamId INTEGER, name TEXT, role TEXT, capabilities TEXT, promptTemplate TEXT, status TEXT, createdAt TEXT, updatedAt TEXT);

  CREATE TABLE IF NOT EXISTS boards(id INTEGER PRIMARY KEY, projectId INTEGER, name TEXT, createdAt TEXT, updatedAt TEXT);
  CREATE TABLE IF NOT EXISTS columns_board(id INTEGER PRIMARY KEY, boardId INTEGER, name TEXT, idx INTEGER, createdAt TEXT, updatedAt TEXT);
  CREATE TABLE IF NOT EXISTS cards(
    id INTEGER PRIMARY KEY,
    boardId INTEGER,
    columnId INTEGER,
    title TEXT,
    description TEXT,
    priority TEXT,
    type TEXT,
    labels TEXT,
    dueDate TEXT,
    storyPoints INTEGER,
    createdBy INTEGER,
    githubRepoUrl TEXT,
    githubBranch TEXT,
    createdAt TEXT,
    updatedAt TEXT
  );
  CREATE TABLE IF NOT EXISTS card_assignees(id INTEGER PRIMARY KEY, cardId INTEGER, agentId INTEGER, createdAt TEXT);
  CREATE TABLE IF NOT EXISTS card_comments(id INTEGER PRIMARY KEY, cardId INTEGER, authorId INTEGER, body TEXT, createdAt TEXT);

  CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY, cardId INTEGER, projectId INTEGER, status TEXT, provider TEXT, model TEXT, createdAt TEXT, updatedAt TEXT);
  CREATE TABLE IF NOT EXISTS message_logs(id INTEGER PRIMARY KEY, runId INTEGER, agentId INTEGER, role TEXT, content TEXT, createdAt TEXT);
  CREATE TABLE IF NOT EXISTS artifacts(id INTEGER PRIMARY KEY, runId INTEGER, cardId INTEGER, kind TEXT, title TEXT, content TEXT, createdAt TEXT);
  CREATE TABLE IF NOT EXISTS llm_request_logs(id INTEGER PRIMARY KEY, runId INTEGER, provider TEXT, model TEXT, request TEXT, response TEXT, createdAt TEXT);
  `);

  const c = db.prepare('SELECT COUNT(*) c FROM llm_provider_configs').get().c;
  if (!c) {
    const t = now();
    db.prepare('INSERT INTO llm_provider_configs(name,baseUrl,modelsJson,apiKeyRef,createdAt,updatedAt) VALUES(?,?,?,?,?,?)')
      .run('openai', 'https://api.openai.com/v1', JSON.stringify(['gpt-4o-mini','gpt-4.1']), 'OPENAI_API_KEY', t, t);
    db.prepare('INSERT INTO llm_provider_configs(name,baseUrl,modelsJson,apiKeyRef,createdAt,updatedAt) VALUES(?,?,?,?,?,?)')
      .run('ollama', 'http://localhost:11434', JSON.stringify(['llama3.1','qwen2.5-coder']), 'N/A', t, t);
  }
}

export const q = {
  all: (sql, ...args) => db.prepare(sql).all(...args),
  one: (sql, ...args) => db.prepare(sql).get(...args),
  run: (sql, ...args) => db.prepare(sql).run(...args),
  now
};
