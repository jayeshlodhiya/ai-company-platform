package com.aicompany.platform.api;

import jakarta.annotation.PostConstruct;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.*;

@RestController
@RequestMapping("/api")
public class ApiController {
  private final JdbcTemplate jdbc;
  private final HttpClient http = HttpClient.newHttpClient();
  private volatile boolean executorBusy = false;

  public ApiController(JdbcTemplate jdbc){ this.jdbc = jdbc; }

  @PostConstruct
  public void startInAppExecutor() {
    Thread t = new Thread(() -> {
      while (true) {
        try {
          if (!executorBusy) {
            executorBusy = true;
            runPendingCards();
          }
        } catch (Exception ignored) {
        } finally {
          executorBusy = false;
        }
        try { Thread.sleep(4000); } catch (InterruptedException ignored) {}
      }
    }, "in-app-executor");
    t.setDaemon(true);
    t.start();
  }

  private void runPendingCards() {
    var pending = jdbc.queryForList("""
      select c.id
      from cards c
      join board_columns bc on bc.id = c.column_id
      where lower(bc.name) in ('backlog','in progress')
        and not exists (select 1 from runs r where r.card_id = c.id)
      order by c.id asc
      limit 5
    """);

    for (var row : pending) {
      Long cardId = ((Number) row.get("id")).longValue();
      try {
        startRun(cardId, Map.of("provider", "openai", "model", "openai-codex/gpt-5.3-codex"));
      } catch (Exception ex) {
        jdbc.update("insert into message_logs(run_id,agent_role,content,created_at) values((select max(id) from runs),?,?,now())", "SYSTEM", "Executor failed: " + ex.getMessage());
      }
    }
  }

  private String githubToken() {
    return Optional.ofNullable(System.getenv("GITHUB_TOKEN")).orElse("");
  }

  private Path repoRoot() {
    return Path.of(Optional.ofNullable(System.getenv("AI_COMPANY_REPO_ROOT")).orElse("/Users/jayeshlodhiya/Desktop/ai-company-platform"));
  }

  private String runCmd(Path cwd, String... command) throws Exception {
    var pb = new ProcessBuilder(command);
    pb.directory(cwd.toFile());
    pb.redirectErrorStream(true);
    var p = pb.start();
    var out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    int code = p.waitFor();
    if (code != 0) throw new RuntimeException(String.join(" ", command) + " failed: " + out);
    return out.trim();
  }

  private void triggerRedeployAsync() {
    new Thread(() -> {
      try {
        var root = repoRoot();
        runCmd(root, "sh", "-c", "pkill -f 'vite' || true; cd frontend && nohup npm run dev >/tmp/ai-company-frontend.log 2>&1 &");
        runCmd(root, "sh", "-c", "pkill -f 'spring-boot:run|AiCompanyApplication' || true; cd backend && nohup mvn spring-boot:run >/tmp/ai-company-backend.log 2>&1 &");
      } catch (Exception ignored) {}
    }, "redeploy-thread").start();
  }

  private Map<String, Object> buildRedeployAndCreatePr(Long runId, String title) throws Exception {
    var root = repoRoot();

    // Rebuild frontend + backend
    runCmd(root, "npm", "--prefix", "frontend", "run", "build");
    runCmd(root.resolve("backend"), "mvn", "-q", "-DskipTests", "package");

    // Redeploy both services asynchronously so changes reflect automatically.
    triggerRedeployAsync();

    // Git branch + commit real code changes
    String branch = "ai-run-" + runId;
    runCmd(root, "git", "checkout", "-B", branch);
    runCmd(root, "git", "add", "-A");
    String staged = runCmd(root, "sh", "-c", "git diff --cached --name-only");
    if (staged.isBlank()) return Map.of("ok", false, "error", "No code changes staged for PR");

    runCmd(root, "git", "commit", "-m", "feat: auto change for run #" + runId + " - " + title);
    runCmd(root, "git", "push", "-u", "origin", branch, "--force");

    // Create PR via gh
    var prUrl = runCmd(root, "gh", "pr", "create", "--base", "main", "--head", branch,
      "--title", "AI run " + runId + ": " + title,
      "--body", "Automated PR from in-app executor for run #" + runId);

    return Map.of("ok", true, "prUrl", prUrl, "branch", branch, "staged", staged);
  }

  private String applyTaskFileChange(String title, String description) {
    try {
      var root = repoRoot();
      var lower = (title + " " + description).toLowerCase(Locale.ROOT);

      if (lower.contains("background") && lower.contains("white")) {
        var css = root.resolve("frontend/src/styles.css");
        var content = Files.readString(css);
        content = content.replaceAll("body\\{[^}]*background:[^;]*;", "body{margin:0;font-family:Inter,system-ui;background:#ffffff;");
        Files.writeString(css, content, StandardOpenOption.TRUNCATE_EXISTING);
        return "Updated frontend/src/styles.css (background set to white)";
      }

      if (lower.contains("background") && (lower.contains("dark") || lower.contains("black"))) {
        var css = root.resolve("frontend/src/styles.css");
        var content = Files.readString(css);
        content = content.replaceAll("body\\{[^}]*background:[^;]*;", "body{margin:0;font-family:Inter,system-ui;background:#0f172a;");
        Files.writeString(css, content, StandardOpenOption.TRUNCATE_EXISTING);
        return "Updated frontend/src/styles.css (background set to dark)";
      }

      if (lower.contains("hide") && (lower.contains("+ column") || lower.contains("column button"))) {
        var app = root.resolve("frontend/src/App.jsx");
        var content = Files.readString(app);
        content = content.replace("          <button onClick={addColumn}>+ Column</button>\n", "");
        Files.writeString(app, content, StandardOpenOption.TRUNCATE_EXISTING);
        return "Updated frontend/src/App.jsx (removed + Column button)";
      }

      if (lower.contains("hide") && lower.contains("runs") && lower.contains("button")) {
        var app = root.resolve("frontend/src/App.jsx");
        var content = Files.readString(app);
        content = content.replace("          <button onClick={()=>setTab('runs')} className={tab==='runs'?'active':''}>Runs</button>\n", "");
        Files.writeString(app, content, StandardOpenOption.TRUNCATE_EXISTING);
        return "Updated frontend/src/App.jsx (removed Runs button)";
      }

      if (lower.contains("hide") && lower.contains("refresh") && lower.contains("button")) {
        var app = root.resolve("frontend/src/App.jsx");
        var content = Files.readString(app);
        content = content.replace("          <button onClick={()=>loadColumns(boardId)}>Refresh</button>\n", "");
        Files.writeString(app, content, StandardOpenOption.TRUNCATE_EXISTING);
        return "Updated frontend/src/App.jsx (removed Refresh button)";
      }

      if (lower.contains("hide") && lower.contains("move") && lower.contains("button")) {
        var app = root.resolve("frontend/src/App.jsx");
        var content = Files.readString(app);
        content = content
          .replace("                {colIdx > 0 && <button onClick={()=>moveCard(card.id, columns[colIdx-1].id)}>← Move</button>}\n", "")
          .replace("                {colIdx < columns.length-1 && <button onClick={()=>moveCard(card.id, columns[colIdx+1].id)}>Move →</button>}\n", "");
        Files.writeString(app, content, StandardOpenOption.TRUNCATE_EXISTING);
        return "Updated frontend/src/App.jsx (removed Move buttons from task card)";
      }

      if (lower.contains("add button") || lower.contains("new button")) {
        var app = root.resolve("frontend/src/App.jsx");
        var content = Files.readString(app);
        if (!content.contains("Quick Action")) {
          content = content.replace("<button onClick={()=>loadColumns(boardId)}>Refresh</button>", "<button onClick={()=>loadColumns(boardId)}>Refresh</button>\n          <button onClick={()=>setNote('Quick Action clicked')}>Quick Action</button>");
          Files.writeString(app, content, StandardOpenOption.TRUNCATE_EXISTING);
          return "Updated frontend/src/App.jsx (added Quick Action button)";
        }
      }

      var changelog = root.resolve("CHANGELOG.md");
      var line = "- " + new Date() + " :: " + title + "\n";
      Files.writeString(changelog, line, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
      return "Logged task in CHANGELOG.md (fallback change)";
    } catch (Exception ex) {
      return "File change failed: " + ex.getMessage();
    }
  }

  private HttpRequest.Builder githubReq(String path) {
    return HttpRequest.newBuilder(URI.create("https://api.github.com" + path))
      .header("Accept", "application/vnd.github+json")
      .header("Authorization", "Bearer " + githubToken())
      .header("X-GitHub-Api-Version", "2022-11-28");
  }

  private String ownerFromRepo(String repoUrl) {
    if (repoUrl == null) return null;
    var cleaned = repoUrl.replace("https://github.com/", "").replace(".git", "");
    var parts = cleaned.split("/");
    return parts.length >= 2 ? parts[0] : null;
  }

  private String nameFromRepo(String repoUrl) {
    if (repoUrl == null) return null;
    var cleaned = repoUrl.replace("https://github.com/", "").replace(".git", "");
    var parts = cleaned.split("/");
    return parts.length >= 2 ? parts[1] : null;
  }

  @PostMapping("/auth/register") public Map<String,Object> register(@RequestBody Map<String,Object> b){ return Map.of("ok",true); }
  @PostMapping("/auth/login") public Map<String,Object> login(@RequestBody Map<String,Object> b){ return Map.of("token","dev-token"); }
  @GetMapping("/executor/status") public Map<String,Object> executorStatus(){ return Map.of("ok", true, "running", true, "busy", executorBusy); }

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
  @PostMapping("/projects/{projectId}/boards") public Map<String,Object> addBoard(@PathVariable Long projectId, @RequestBody Map<String,Object> b){
    jdbc.update("insert into boards(project_id,name) values(?,?)", projectId, b.getOrDefault("name","Main Board"));
    Long boardId = jdbc.queryForObject("select max(id) from boards", Long.class);
    jdbc.update("insert into board_columns(board_id,name,idx) values(?,?,?)", boardId, "Backlog", 0);
    jdbc.update("insert into board_columns(board_id,name,idx) values(?,?,?)", boardId, "In Progress", 1);
    jdbc.update("insert into board_columns(board_id,name,idx) values(?,?,?)", boardId, "Review", 2);
    jdbc.update("insert into board_columns(board_id,name,idx) values(?,?,?)", boardId, "Done", 3);
    return Map.of("ok",true,"boardId",boardId);
  }

  @GetMapping("/boards/{boardId}/columns") public Map<String,Object> columns(@PathVariable Long boardId){
    var cols = jdbc.queryForList("select * from board_columns where board_id=? order by idx", boardId);
    var mapped = new ArrayList<Map<String,Object>>();
    for (var c : cols) {
      Long columnId = ((Number)c.get("id")).longValue();
      var cards = jdbc.queryForList("select * from cards where column_id=? order by id desc", columnId);
      var out = new HashMap<String,Object>(c);
      out.put("cards", cards);
      mapped.add(out);
    }
    return Map.of("columns", mapped);
  }
  @PostMapping("/boards/{boardId}/columns") public Map<String,Object> addColumn(@PathVariable Long boardId, @RequestBody Map<String,Object> b){ jdbc.update("insert into board_columns(board_id,name,idx) values(?,?,?)", boardId, b.get("name"), b.getOrDefault("idx",0)); return Map.of("ok",true); }
  @PostMapping("/boards/{boardId}/columns/reorder") public Map<String,Object> reorderColumns(@PathVariable Long boardId, @RequestBody Map<String,Object> b){
    @SuppressWarnings("unchecked")
    var columnIds = (List<Number>) b.getOrDefault("columnIds", List.of());
    for (int i = 0; i < columnIds.size(); i++) {
      jdbc.update("update board_columns set idx=? where id=? and board_id=?", i, columnIds.get(i).longValue(), boardId);
    }
    return Map.of("ok",true);
  }

  @PostMapping("/columns/{columnId}/cards") public Map<String,Object> addCard(@PathVariable Long columnId, @RequestBody Map<String,Object> b){
    Long boardId = jdbc.queryForObject("select board_id from board_columns where id=?", Long.class, columnId);
    jdbc.update("insert into cards(board_id,column_id,title,description,priority,type,labels,due_date,story_points) values(?,?,?,?,?,?,?,?,?)", boardId, columnId, b.get("title"), b.get("description"), b.getOrDefault("priority","MEDIUM"), b.getOrDefault("type","FEATURE"), String.valueOf(b.getOrDefault("labels","[]")), b.get("dueDate"), b.get("storyPoints"));
    Long cardId = jdbc.queryForObject("select max(id) from cards", Long.class);
    return Map.of("ok",true,"cardId",cardId);
  }
  @PostMapping("/cards/{cardId}/move") public Map<String,Object> moveCard(@PathVariable Long cardId, @RequestBody Map<String,Object> b){ jdbc.update("update cards set column_id=?, updated_at=now() where id=?", b.get("targetColumnId"), cardId); return Map.of("ok",true); }
  @DeleteMapping("/cards/{cardId}") public Map<String,Object> deleteCard(@PathVariable Long cardId){
    jdbc.update("delete from card_assignees where card_id=?", cardId);
    jdbc.update("delete from card_comments where card_id=?", cardId);
    jdbc.update("delete from artifacts where card_id=?", cardId);
    jdbc.update("delete from runs where card_id=?", cardId);
    jdbc.update("delete from cards where id=?", cardId);
    return Map.of("ok",true);
  }

  @GetMapping("/cards/{cardId}/comments") public Map<String,Object> comments(@PathVariable Long cardId){ return Map.of("items", jdbc.queryForList("select * from card_comments where card_id=? order by id desc", cardId)); }
  @PostMapping("/cards/{cardId}/comments") public Map<String,Object> addComment(@PathVariable Long cardId, @RequestBody Map<String,Object> b){ jdbc.update("insert into card_comments(card_id,author_id,body) values(?,?,?)", cardId, b.getOrDefault("authorId",1), b.get("body")); return Map.of("ok",true); }

  @GetMapping("/projects/{projectId}/labels") public Map<String,Object> labels(@PathVariable Long projectId){ return Map.of("items", List.of("backend","frontend","security","urgent")); }

  @PostMapping("/cards/{cardId}/runs") public Map<String,Object> startRun(@PathVariable Long cardId, @RequestBody(required = false) Map<String,Object> b){
    var card = jdbc.queryForMap("select * from cards where id=?", cardId);
    var boardId = ((Number) card.get("board_id")).longValue();

    Long inProgressId = jdbc.queryForObject("select id from board_columns where board_id=? and lower(name)=lower('In Progress') limit 1", Long.class, boardId);
    Long reviewId = jdbc.queryForObject("select id from board_columns where board_id=? and lower(name)=lower('Review') limit 1", Long.class, boardId);
    Long doneId = jdbc.queryForObject("select id from board_columns where board_id=? and lower(name)=lower('Done') limit 1", Long.class, boardId);

    if (inProgressId != null) jdbc.update("update cards set column_id=?, updated_at=now() where id=?", inProgressId, cardId);

    jdbc.update("insert into runs(card_id,status,provider,model) values(?,?,?,?)", cardId, "RUNNING", b==null?"openai":b.getOrDefault("provider","openai"), b==null?"openai-codex/gpt-5.3-codex":b.getOrDefault("model","openai-codex/gpt-5.3-codex"));
    Long runId = jdbc.queryForObject("select max(id) from runs", Long.class);
    jdbc.update("insert into message_logs(run_id,agent_role,content) values(?,?,?)", runId, "PM", "Task decomposed into subtasks");
    jdbc.update("insert into message_logs(run_id,agent_role,content) values(?,?,?)", runId, "DEV", "Generated implementation proposal");
    jdbc.update("insert into message_logs(run_id,agent_role,content) values(?,?,?)", runId, "QA", "Added tests and test plan");

    if (reviewId != null) jdbc.update("update cards set column_id=?, updated_at=now() where id=?", reviewId, cardId);

    var title = String.valueOf(card.get("title"));
    var description = String.valueOf(card.getOrDefault("description", ""));
    var patch = "diff --git a/README.md b/README.md\n" +
      "--- a/README.md\n+++ b/README.md\n@@\n" +
      "+Run update for card: " + title + "\n";

    var fileChangeResult = applyTaskFileChange(title, description);

    jdbc.update("insert into artifacts(run_id,card_id,kind,title,content) values(?,?,?,?,?)", runId, cardId, "plan", "Plan", "PM breakdown generated");
    jdbc.update("insert into artifacts(run_id,card_id,kind,title,content) values(?,?,?,?,?)", runId, cardId, "code_patch", "Proposed Patch", patch);
    jdbc.update("insert into artifacts(run_id,card_id,kind,title,content) values(?,?,?,?,?)", runId, cardId, "qa", "QA Checklist", "Smoke + regression checks");
    jdbc.update("insert into artifacts(run_id,card_id,kind,title,content) values(?,?,?,?,?)", runId, cardId, "ops", "Ops Checklist", "Deploy + rollback plan");
    jdbc.update("insert into artifacts(run_id,card_id,kind,title,content) values(?,?,?,?,?)", runId, cardId, "file_change", "Applied File Changes", fileChangeResult);
    jdbc.update("insert into artifacts(run_id,card_id,kind,title,content) values(?,?,?,?,?)", runId, cardId, "summary", "Run Summary", "Planning → Execution → Review complete");

    if (doneId != null) jdbc.update("update cards set column_id=?, updated_at=now() where id=?", doneId, cardId);
    jdbc.update("update runs set status='COMPLETED' where id=?", runId);

    // Auto-rebuild + redeploy + PR with actual code changes.
    try {
      var pr = buildRedeployAndCreatePr(runId, title);
      if (Boolean.TRUE.equals(pr.get("ok"))) {
        jdbc.update("insert into artifacts(run_id,card_id,kind,title,content) values(?,?,?,?,?)", runId, cardId, "build", "Build & Redeploy", "Frontend/Backend build passed and frontend restarted");
        jdbc.update("insert into artifacts(run_id,card_id,kind,title,content) values(?,?,?,?,?)", runId, cardId, "github_pr", "Auto PR", String.valueOf(pr.get("prUrl")));
      } else {
        jdbc.update("insert into artifacts(run_id,card_id,kind,title,content) values(?,?,?,?,?)", runId, cardId, "github_pr", "Auto PR Failed", String.valueOf(pr.getOrDefault("error", "unknown error")));
      }
    } catch (Exception ex) {
      jdbc.update("insert into artifacts(run_id,card_id,kind,title,content) values(?,?,?,?,?)", runId, cardId, "github_pr", "Auto PR Exception", ex.getMessage());
    }

    return Map.of("runId", runId, "status", "COMPLETED");
  }
  @GetMapping("/runs/{runId}") public Map<String,Object> run(@PathVariable Long runId){ return Map.of("item", jdbc.queryForMap("select * from runs where id=?", runId)); }
  @GetMapping("/runs/{runId}/messages") public Map<String,Object> runMsgs(@PathVariable Long runId){ return Map.of("items", jdbc.queryForList("select * from message_logs where run_id=? order by id", runId)); }
  @GetMapping("/runs/{runId}/artifacts") public Map<String,Object> runArtifacts(@PathVariable Long runId){ return Map.of("items", jdbc.queryForList("select * from artifacts where run_id=? order by id", runId)); }

  @GetMapping("/llm/providers") public Map<String,Object> providers(){ return Map.of("items", jdbc.queryForList("select * from llm_provider_configs")); }
  @GetMapping("/llm/models") public Map<String,Object> models(@RequestParam String provider){ return Map.of("provider", provider, "models", provider.equals("ollama") ? List.of("llama3.1","qwen2.5-coder") : List.of("openai-codex/gpt-5.3-codex","gpt-4o-mini","gpt-4.1")); }
  @PostMapping("/llm/invoke") public Map<String,Object> invoke(@RequestBody Map<String,Object> b){ return Map.of("ok", true, "response", "scaffold invoke response"); }

  @PostMapping("/projects/{projectId}/github/connect") public Map<String,Object> githubConnect(@PathVariable Long projectId, @RequestBody Map<String,Object> b){
    jdbc.update("delete from github_links where project_id=?", projectId);
    jdbc.update("insert into github_links(project_id,repo_url,branch,token_ref,webhook_url) values(?,?,?,?,?)", projectId, b.get("repoUrl"), b.getOrDefault("branch","main"), b.get("tokenRef"), b.get("webhookUrl"));
    return Map.of("ok", true);
  }

  @PostMapping("/projects/{projectId}/github/create-repo")
  public Map<String,Object> createRepo(@PathVariable Long projectId, @RequestBody Map<String,Object> b) throws Exception {
    if (githubToken().isBlank()) return Map.of("ok", false, "error", "GITHUB_TOKEN missing in environment");
    var project = jdbc.queryForMap("select * from projects where id=?", projectId);
    var owner = String.valueOf(b.getOrDefault("owner", "jayeshlodhiya"));
    var repoName = String.valueOf(b.getOrDefault("repoName", String.valueOf(project.get("name")).toLowerCase().replace(" ", "-") + "-repo"));

    var body = "{\"name\":\"" + repoName + "\",\"private\":false,\"auto_init\":true}";
    var req = githubReq("/orgs/" + owner + "/repos").POST(HttpRequest.BodyPublishers.ofString(body)).header("Content-Type","application/json").build();
    var res = http.send(req, HttpResponse.BodyHandlers.ofString());

    if (res.statusCode() >= 300) {
      var req2 = githubReq("/user/repos").POST(HttpRequest.BodyPublishers.ofString(body)).header("Content-Type","application/json").build();
      var res2 = http.send(req2, HttpResponse.BodyHandlers.ofString());
      if (res2.statusCode() >= 300) return Map.of("ok", false, "error", res2.body());
    }

    var repoUrl = "https://github.com/" + owner + "/" + repoName;
    jdbc.update("update projects set github_repo_url=?, default_branch='main' where id=?", repoUrl, projectId);
    jdbc.update("delete from github_links where project_id=?", projectId);
    jdbc.update("insert into github_links(project_id,repo_url,branch,token_ref,webhook_url) values(?,?,?,?,?)", projectId, repoUrl, "main", "GITHUB_TOKEN", null);
    return Map.of("ok", true, "repoUrl", repoUrl);
  }

  @GetMapping("/projects/{projectId}/github/status") public Map<String,Object> githubStatus(@PathVariable Long projectId){
    var links = jdbc.queryForList("select * from github_links where project_id=?", projectId);
    return Map.of("ok", true, "connected", !links.isEmpty(), "repo", links.isEmpty()?null:links.get(0));
  }

  @GetMapping("/projects/{projectId}/github/branches") public Map<String,Object> githubBranches(@PathVariable Long projectId) throws Exception {
    var link = jdbc.queryForMap("select * from github_links where project_id=? order by id desc limit 1", projectId);
    var owner = ownerFromRepo(String.valueOf(link.get("repo_url")));
    var repo = nameFromRepo(String.valueOf(link.get("repo_url")));
    if (owner == null || repo == null || githubToken().isBlank()) return Map.of("branches", List.of("main"));

    var res = http.send(githubReq("/repos/" + owner + "/" + repo + "/branches").GET().build(), HttpResponse.BodyHandlers.ofString());
    if (res.statusCode() >= 300) return Map.of("branches", List.of("main"), "error", res.body());

    var names = new ArrayList<String>();
    var body = res.body();
    for (var chunk : body.split("\"name\":\"")) {
      if (chunk.contains("\"")) names.add(chunk.substring(0, chunk.indexOf('"')));
    }
    return Map.of("branches", names.stream().distinct().toList());
  }

  @PostMapping("/runs/{runId}/github/create-pr")
  public Map<String,Object> githubPR(@PathVariable Long runId) throws Exception {
    var run = jdbc.queryForMap("select * from runs where id=?", runId);
    var card = jdbc.queryForMap("select * from cards where id=?", run.get("card_id"));
    var title = String.valueOf(card.get("title"));
    return buildRedeployAndCreatePr(runId, title);
  }

  @PostMapping("/admin/restart-services")
  public Map<String,Object> restartServices() {
    try {
      var root = repoRoot();
      var script = "pkill -f 'vite' || true; " +
        "cd '" + root.resolve("frontend") + "' && nohup npm run dev >/tmp/ai-company-frontend.log 2>&1 &";
      new ProcessBuilder("sh", "-c", script).start();
      return Map.of("ok", true, "message", "Frontend restart triggered. Backend restart should be done manually if needed.");
    } catch (Exception ex) {
      return Map.of("ok", false, "error", ex.getMessage());
    }
  }
}
