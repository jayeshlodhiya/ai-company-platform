import { q } from './db.js';
import { callLlm } from './llmClient.js';

const roleToPrompt = {
  PM: 'Decompose card into executable subtasks with acceptance criteria.',
  DEV: 'Propose implementation plan and code patch summary.',
  QA: 'Generate test plan and test cases.',
  OPS: 'Generate deployment and rollback checklist.',
  SECURITY: 'List security checks and risks.'
};

export async function startRunFromCard({ cardId, provider, model }) {
  const card = q.one('SELECT * FROM cards WHERE id=?', cardId);
  if (!card) throw new Error('card not found');
  const run = q.run('INSERT INTO runs(cardId,projectId,status,provider,model,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)', cardId, card.boardId, 'RUNNING', provider || 'openai', model || 'gpt-4o-mini', q.now(), q.now());
  const runId = run.lastInsertRowid;

  const assignees = q.all(`SELECT a.* FROM card_assignees ca JOIN agents a ON a.id=ca.agentId WHERE ca.cardId=?`, cardId);
  const roles = [...new Set(assignees.map(a => a.role.toUpperCase()))];
  const pipeline = roles.length ? roles : ['PM', 'DEV', 'QA', 'OPS'];

  for (const role of pipeline) {
    const agent = assignees.find(a => a.role.toUpperCase() === role) || { id: null, name: role };
    const prompt = `${roleToPrompt[role] || 'Contribute to task'}\nTask: ${card.title}\nDescription: ${card.description || ''}`;
    const out = await callLlm({ runId, provider, model, prompt });
    q.run('INSERT INTO message_logs(runId,agentId,role,content,createdAt) VALUES(?,?,?,?,?)', runId, agent.id, role, out, q.now());
    q.run('INSERT INTO artifacts(runId,cardId,kind,title,content,createdAt) VALUES(?,?,?,?,?,?)', runId, cardId, role.toLowerCase(), `${role} Output`, out, q.now());
  }

  const summary = 'Run completed. Review artifacts and create follow-up cards if needed.';
  q.run('INSERT INTO artifacts(runId,cardId,kind,title,content,createdAt) VALUES(?,?,?,?,?,?)', runId, cardId, 'summary', 'Run Summary', summary, q.now());
  q.run('UPDATE runs SET status=?, updatedAt=? WHERE id=?', 'COMPLETED', q.now(), runId);
  return q.one('SELECT * FROM runs WHERE id=?', runId);
}
