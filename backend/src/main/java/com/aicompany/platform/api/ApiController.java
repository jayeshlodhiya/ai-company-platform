package com.aicompany.platform.api;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api")
public class ApiController {
  private final JdbcTemplate jdbc;
  public ApiController(JdbcTemplate jdbc){ this.jdbc = jdbc; }

  @PostMapping("/auth/register") public Map<String,Object> register(@RequestBody Map<String,Object> b){ return Map.of("ok",true); }
  @PostMapping("/auth/login") public Map<String,Object> login(@RequestBody Map<String,Object> b){ return Map.of("token","dev-token"); }

  @GetMapping("/companies") public Map<String,Object> companies(){ return Map.of("items", jdbc.queryForList("select * from companies order by id desc")); }
  @PostMapping("/companies") public Map<String,Object> addCompany(@RequestBody Map<String,Object> b){ jdbc.update("insert into companies(name) values(?)", b.get("name")); return Map.of("ok",true); }

  @GetMapping("/sites") public Map<String,Object> sites(){ return Map.of("items", jdbc.queryForList("select * from sites order by id desc")); }
  @PostMapping("/sites") public Map<String,Object> addSite(@RequestBody Map<String,Object> b){ jdbc.update("insert into sites(company_id,name,region) values(?,?,?)", b.get("companyId"), b.get("name"), b.get("region")); return Map.of("ok",true); }

  @GetMapping("/teams") public Map<String,Object> teams(){ return Map.of("items", jdbc.queryForList("select * from teams order by id desc")); }
  @PostMapping("/teams") public Map<String,Object> addTeam(@RequestBody Map<String,Object> b){ jdbc.update("insert into teams(site_id,name) values(?,?)", b.get("siteId"), b.get("name")); return Map.of("ok",true); }

  @GetMapping("/projects") public Map<String,Object> projects(){ return Map.of("items", jdbc.queryForList("select * from projects order by id desc")); }
  @PostMapping("/projects") public Map<String,Object> addProject(@RequestBody Map<String,Object> b){ jdbc.update("insert into projects(team_id,name,description,github_repo_url,default_branch) values(?,?,?,?,?)", b.get("teamId"), b.get("name"), b.get("description"), b.get("githubRepoUrl"), b.getOrDefault("defaultBranch","main")); return Map.of("ok",true); }

  @GetMapping("/agents") public Map<String,Object> agents(){ return Map.of("items", jdbc.queryForList("select * from agents order by id desc")); }
  @PostMapping("/agents") public Map<String,Object> addAgent(@RequestBody Map<String,Object> b){ jdbc.update("insert into agents(team_id,name,role,capabilities,prompt_template,status) values(?,?,?,?,?,?)", b.get("teamId"), b.get("name"), b.get("role"), b.get("capabilities"), b.get("promptTemplate"), "ACTIVE"); return Map.of("ok",true); }
  @PutMapping("/agents/{id}/prompt") public Map<String,Object> updatePrompt(@PathVariable Long id,@RequestBody Map<String,Object> b){ jdbc.update("update agents set prompt_template=? where id=?", b.get("promptTemplate"), id); return Map.of("ok",true); }

  @GetMapping("/projects/{projectId}/boards") public Map<String,Object> boards(@PathVariable Long projectId){ return Map.of("items", jdbc.queryForList("select * from boards where project_id=? order by id", projectId)); }
  @PostMapping("/projects/{projectId}/boards") public Map<String,Object> addBoard(@PathVariable Long projectId, @RequestBody Map<String,Object> b){ jdbc.update("insert into boards(project_id,name) values(?,?)", projectId, b.getOrDefault("name","Main Board")); return Map.of("ok",true); }

  @GetMapping("/boards/{boardId}/columns") public Map<String,Object> columns(@PathVariable Long boardId){ return Map.of("columns", jdbc.queryForList("select * from board_columns where board_id=? order by idx", boardId)); }
  @PostMapping("/boards/{boardId}/columns") public Map<String,Object> addColumn(@PathVariable Long boardId, @RequestBody Map<String,Object> b){ jdbc.update("insert into board_columns(board_id,name,idx) values(?,?,?)", boardId, b.get("name"), b.getOrDefault("idx",0)); return Map.of("ok",true); }
  @PostMapping("/boards/{boardId}/columns/reorder") public Map<String,Object> reorderColumns(@PathVariable Long boardId, @RequestBody Map<String,Object> b){ return Map.of("ok",true,"scaffold",true); }

  @PostMapping("/columns/{columnId}/cards") public Map<String,Object> addCard(@PathVariable Long columnId, @RequestBody Map<String,Object> b){
    Long boardId = jdbc.queryForObject("select board_id from board_columns where id=?", Long.class, columnId);
    jdbc.update("insert into cards(board_id,column_id,title,description,priority,type,labels,due_date,story_points) values(?,?,?,?,?,?,?,?,?)", boardId, columnId, b.get("title"), b.get("description"), b.getOrDefault("priority","MEDIUM"), b.getOrDefault("type","FEATURE"), String.valueOf(b.getOrDefault("labels","[]")), b.get("dueDate"), b.get("storyPoints"));
    return Map.of("ok",true);
  }
  @PostMapping("/cards/{cardId}/move") public Map<String,Object> moveCard(@PathVariable Long cardId, @RequestBody Map<String,Object> b){ jdbc.update("update cards set column_id=?, updated_at=now() where id=?", b.get("targetColumnId"), cardId); return Map.of("ok",true); }

  @GetMapping("/cards/{cardId}/comments") public Map<String,Object> comments(@PathVariable Long cardId){ return Map.of("items", jdbc.queryForList("select * from card_comments where card_id=? order by id desc", cardId)); }
  @PostMapping("/cards/{cardId}/comments") public Map<String,Object> addComment(@PathVariable Long cardId, @RequestBody Map<String,Object> b){ jdbc.update("insert into card_comments(card_id,author_id,body) values(?,?,?)", cardId, b.getOrDefault("authorId",1), b.get("body")); return Map.of("ok",true); }

  @GetMapping("/projects/{projectId}/labels") public Map<String,Object> labels(@PathVariable Long projectId){ return Map.of("items", List.of("backend","frontend","security","urgent")); }

  @PostMapping("/cards/{cardId}/runs") public Map<String,Object> startRun(@PathVariable Long cardId, @RequestBody(required = false) Map<String,Object> b){
    jdbc.update("insert into runs(card_id,status,provider,model) values(?,?,?,?)", cardId, "COMPLETED", b==null?"openai":b.getOrDefault("provider","openai"), b==null?"gpt-4o-mini":b.getOrDefault("model","gpt-4o-mini"));
    Long runId = jdbc.queryForObject("select max(id) from runs", Long.class);
    jdbc.update("insert into message_logs(run_id,agent_role,content) values(?,?,?)", runId, "PM", "Task decomposed into subtasks");
    jdbc.update("insert into message_logs(run_id,agent_role,content) values(?,?,?)", runId, "DEV", "Generated implementation proposal");
    jdbc.update("insert into message_logs(run_id,agent_role,content) values(?,?,?)", runId, "QA", "Added tests and test plan");
    jdbc.update("insert into artifacts(run_id,card_id,kind,title,content) values(?,?,?,?,?)", runId, cardId, "summary", "Run Summary", "Planning → Execution → Review complete");
    return Map.of("runId", runId, "status", "COMPLETED");
  }
  @GetMapping("/runs/{runId}") public Map<String,Object> run(@PathVariable Long runId){ return Map.of("item", jdbc.queryForMap("select * from runs where id=?", runId)); }
  @GetMapping("/runs/{runId}/messages") public Map<String,Object> runMsgs(@PathVariable Long runId){ return Map.of("items", jdbc.queryForList("select * from message_logs where run_id=? order by id", runId)); }
  @GetMapping("/runs/{runId}/artifacts") public Map<String,Object> runArtifacts(@PathVariable Long runId){ return Map.of("items", jdbc.queryForList("select * from artifacts where run_id=? order by id", runId)); }

  @GetMapping("/llm/providers") public Map<String,Object> providers(){ return Map.of("items", jdbc.queryForList("select * from llm_provider_configs")); }
  @GetMapping("/llm/models") public Map<String,Object> models(@RequestParam String provider){ return Map.of("provider", provider, "models", provider.equals("ollama") ? List.of("llama3.1","qwen2.5-coder") : List.of("gpt-4o-mini","gpt-4.1")); }
  @PostMapping("/llm/invoke") public Map<String,Object> invoke(@RequestBody Map<String,Object> b){ return Map.of("ok", true, "response", "scaffold invoke response"); }

  @PostMapping("/projects/{projectId}/github/connect") public Map<String,Object> githubConnect(@PathVariable Long projectId, @RequestBody Map<String,Object> b){
    jdbc.update("insert into github_links(project_id,repo_url,branch,token_ref,webhook_url) values(?,?,?,?,?)", projectId, b.get("repoUrl"), b.getOrDefault("branch","main"), b.get("tokenRef"), b.get("webhookUrl"));
    return Map.of("ok", true);
  }
  @GetMapping("/projects/{projectId}/github/status") public Map<String,Object> githubStatus(@PathVariable Long projectId){ return Map.of("ok", true, "connected", true); }
  @GetMapping("/projects/{projectId}/github/branches") public Map<String,Object> githubBranches(@PathVariable Long projectId){ return Map.of("branches", List.of("main","develop","feature/ai-run")); }
  @PostMapping("/runs/{runId}/github/create-pr") public Map<String,Object> githubPR(@PathVariable Long runId){ return Map.of("ok", true, "prUrl", "https://github.com/example/repo/pull/123"); }
}
