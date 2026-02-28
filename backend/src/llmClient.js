import { q } from './db.js';

export async function callLlm({ runId, provider = 'openai', model = 'gpt-4o-mini', prompt }) {
  // Scaffold adapter: store logs; wire real calls later.
  const response = `[${provider}/${model}] ${prompt.slice(0, 280)}`;
  q.run('INSERT INTO llm_request_logs(runId,provider,model,request,response,createdAt) VALUES(?,?,?,?,?,?)', runId, provider, model, prompt, response, q.now());
  return response;
}
