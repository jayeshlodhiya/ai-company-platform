package com.aicompany.platform.service;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class ExecutionEngine {
  private final Path repoRoot;

  public record Result(boolean changed, String summary) {}

  public ExecutionEngine(Path repoRoot) {
    this.repoRoot = repoRoot;
  }

  private Path safeResolve(String rel) {
    Path p = repoRoot.resolve(rel).normalize();
    if (!p.startsWith(repoRoot)) throw new RuntimeException("Path outside repo is not allowed");
    return p;
  }

  public Result runFromInstruction(String title, String description) {
    String raw = (title + "\n" + (description == null ? "" : description)).trim();
    String lower = raw.toLowerCase(Locale.ROOT);

    try {
      // Smart intent mode (no file path): infer common UI changes.
      if (lower.contains("button") && (lower.contains("blue") || lower.contains("#2563eb"))) {
        Path css = safeResolve("frontend/src/styles.css");
        if (Files.exists(css)) {
          String content = Files.readString(css);
          content = content.replaceAll("\\.tabs button\\{[^}]*\\}", ".tabs button{padding:8px 12px;border:1px solid #2563eb;border-radius:999px;background:#2563eb;color:#fff;cursor:pointer}");
          content = content.replaceAll("\\.card button,\\.panel button\\{[^}]*\\}", ".card button,.panel button{padding:7px 10px;border-radius:8px;border:1px solid #2563eb;background:#2563eb;color:#fff;cursor:pointer}");
          Files.writeString(css, content, StandardOpenOption.TRUNCATE_EXISTING);
          return new Result(true, "Smart intent: updated button color to blue in frontend/src/styles.css");
        }
      }

      // Smart backend intent: add /api/health endpoint automatically.
      if ((lower.contains("backend") || lower.contains("api") || lower.contains("server"))
        && (lower.contains("health") || lower.contains("healthcheck"))) {
        Path apiCtrl = safeResolve("backend/src/main/java/com/aicompany/platform/api/ApiController.java");
        if (Files.exists(apiCtrl)) {
          String content = Files.readString(apiCtrl);
          if (!content.contains("@GetMapping(\"/health\")")) {
            String insert = "\n  @GetMapping(\"/health\") public java.util.Map<String,Object> health(){ return java.util.Map.of(\"ok\", true, \"service\", \"ai-company-backend\"); }\n";
            int idx = content.lastIndexOf("}\n");
            if (idx > 0) {
              content = content.substring(0, idx) + insert + content.substring(idx);
              Files.writeString(apiCtrl, content, StandardOpenOption.TRUNCATE_EXISTING);
              return new Result(true, "Smart backend intent: added /api/health endpoint in ApiController");
            }
          }
        }
      }

      // Smart backend intent: change server port in application.yml
      if ((lower.contains("backend") || lower.contains("server")) && lower.contains("port")) {
        Matcher portMatcher = Pattern.compile("(?:port\\s*(?:to|=)?\\s*)(\\d{3,5})", Pattern.CASE_INSENSITIVE).matcher(lower);
        if (portMatcher.find()) {
          String port = portMatcher.group(1);
          Path yml = safeResolve("backend/src/main/resources/application.yml");
          if (Files.exists(yml)) {
            String content = Files.readString(yml);
            content = content.replaceAll("server:\\s*\\n\\s*port:\\s*\\d+", "server:\n  port: " + port);
            Files.writeString(yml, content, StandardOpenOption.TRUNCATE_EXISTING);
            return new Result(true, "Smart backend intent: updated backend server.port to " + port);
          }
        }
      }

      // Smart intent: hide specific button by visible label in App.jsx
      if (lower.contains("hide") && lower.contains("button")) {
        String label = null;
        Matcher quoted = Pattern.compile("\"([^\"]+button[^\"]*)\"", Pattern.CASE_INSENSITIVE).matcher(raw);
        if (quoted.find()) label = quoted.group(1).replace(" button", "").trim();
        if (label == null) {
          Matcher plain = Pattern.compile("hide\\s+([a-z0-9+\\- ]+)\\s+button", Pattern.CASE_INSENSITIVE).matcher(lower);
          if (plain.find()) label = plain.group(1).trim();
        }
        if (label != null && !label.isBlank()) {
          Path app = safeResolve("frontend/src/App.jsx");
          if (Files.exists(app)) {
            String content = Files.readString(app);
            String escaped = Pattern.quote(label);
            String updated = content.replaceAll("(?m)^\\s*<button[^>]*>" + escaped + "</button>\\s*\\n", "");
            if (!updated.equals(content)) {
              Files.writeString(app, updated, StandardOpenOption.TRUNCATE_EXISTING);
              return new Result(true, "Smart intent: removed button labeled '" + label + "' from frontend/src/App.jsx");
            }
          }
        }
      }

      // create file <path> with <content>
      Matcher create = Pattern.compile("create\\s+file\\s+([^\\s]+)\\s+with\\s+([\\s\\S]+)", Pattern.CASE_INSENSITIVE).matcher(raw);
      if (create.find()) {
        Path p = safeResolve(create.group(1).trim());
        Files.createDirectories(p.getParent());
        Files.writeString(p, create.group(2).trim() + "\n", StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
        return new Result(true, "Created file: " + repoRoot.relativize(p));
      }

      // append to <path>: <content>
      Matcher append = Pattern.compile("append\\s+to\\s+([^:]+):\\s*([\\s\\S]+)", Pattern.CASE_INSENSITIVE).matcher(raw);
      if (append.find()) {
        Path p = safeResolve(append.group(1).trim());
        Files.createDirectories(p.getParent());
        Files.writeString(p, "\n" + append.group(2).trim() + "\n", StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        return new Result(true, "Appended to file: " + repoRoot.relativize(p));
      }

      // replace in <path>: <old> => <new>
      Matcher repl = Pattern.compile("replace\\s+in\\s+([^:]+):\\s*([\\s\\S]+?)\\s*=>\\s*([\\s\\S]+)", Pattern.CASE_INSENSITIVE).matcher(raw);
      if (repl.find()) {
        Path p = safeResolve(repl.group(1).trim());
        String oldText = repl.group(2);
        String newText = repl.group(3);
        if (!Files.exists(p)) return new Result(false, "Replace failed: file not found " + repoRoot.relativize(p));
        String content = Files.readString(p);
        if (!content.contains(oldText)) return new Result(false, "Replace failed: old text not found in " + repoRoot.relativize(p));
        Files.writeString(p, content.replace(oldText, newText), StandardOpenOption.TRUNCATE_EXISTING);
        return new Result(true, "Replaced text in file: " + repoRoot.relativize(p));
      }

      // run command: <cmd>
      Matcher cmd = Pattern.compile("run\\s+command:\\s*([\\s\\S]+)", Pattern.CASE_INSENSITIVE).matcher(raw);
      if (cmd.find()) {
        String command = cmd.group(1).trim();
        if (command.contains("rm -rf") || command.contains("shutdown") || command.contains(":(){")) {
          return new Result(false, "Blocked dangerous command");
        }
        ProcessBuilder pb = new ProcessBuilder("sh", "-c", command);
        pb.directory(repoRoot.toFile());
        pb.redirectErrorStream(true);
        Process p = pb.start();
        String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        int code = p.waitFor();
        return new Result(code == 0, "Command " + (code == 0 ? "succeeded" : "failed") + ": " + out);
      }

      // explicit file target syntax: file:<path>
      Matcher fileTarget = Pattern.compile("file:([^\n\r ]+)", Pattern.CASE_INSENSITIVE).matcher(raw);
      if (fileTarget.find()) {
        Path p = safeResolve(fileTarget.group(1).trim());
        Files.createDirectories(p.getParent());
        String line = "// task update: " + title + "\n";
        Files.writeString(p, line, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        return new Result(true, "Applied generic update in file target: " + repoRoot.relativize(p));
      }

      if (lower.contains("implement") || lower.contains("change") || lower.contains("update")) {
        return new Result(false, "No executable instruction pattern found. Use: create file / append to / replace in / run command / file:<path>");
      }
      return new Result(false, "No actionable instruction pattern matched");
    } catch (Exception ex) {
      return new Result(false, "Execution engine error: " + ex.getMessage());
    }
  }
}
