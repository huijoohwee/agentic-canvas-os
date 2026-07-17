---
title: "Knowgrph Agentic Canvas OS Validation Runbook"
graphId: "md:knowgrph-agentic-canvas-os-validation-runbook"
doc_type: "Validation Runbook"
date: "2026-07-16"
lang: "en-US"
schema: "agentic-canvas-os-validation-runbook/v1"
frontmatter_contract: "required"
status: "runtime-ready"
publish_policy: "Dev-only until explicit operator approval"
runtime_scope: "Agentic Canvas OS docs control surface"
runtime_proof: "RUNTIME-PROOF.md"
kgCanvasSurfaceMode: "2d"
kgCanvasRenderMode: "2d"
kgCanvas2dRenderer: "storyboard"
kgDocumentSemanticMode: "document"
kgFrontmatterModeEnabled: true
kgMultiDimTableModeEnabled: true
kgDocumentStructureBaselineLock: false
socket_types:
  validation_parse_signal:
    label: "Validation parse signal"
    cardinality: "one-to-many"
  validation_route_signal:
    label: "Validation route signal"
    cardinality: "one-to-many"
  validation_proof_signal:
    label: "Validation proof signal"
    cardinality: "one-to-one"
flow:
  direction: {key: direction, type: string, value: "LR"}
  edgeType: {key: edgeType, type: string, value: "smoothstep"}
  balancedViewportPreset: {key: balancedViewportPreset, type: string, value: "widgetFrontmatter"}
  computed: {key: computed, type: boolean, value: true}
  snapToGrid: {key: snapToGrid, type: boolean, value: true}
  nodes:
    - id: {key: id, type: string, value: "frontmatter_parse"}
      type: {key: type, type: string, value: "source"}
      label: {key: label, type: string, value: "Frontmatter parse"}
      lane: {key: lane, type: string, value: "parse"}
      position: {key: position, type: object, value: {x: 0, y: 0}}
      handles: {key: handles, type: list, value: ["parse.out"]}
      "flow:portTypes": {key: "flow:portTypes", type: list, value: ["validation_parse_signal"]}
    - id: {key: id, type: string, value: "route_consistency"}
      type: {key: type, type: string, value: "process"}
      label: {key: label, type: string, value: "Route consistency"}
      lane: {key: lane, type: string, value: "validation"}
      position: {key: position, type: object, value: {x: 280, y: 0}}
      handles: {key: handles, type: list, value: ["route.in", "route.out"]}
    - id: {key: id, type: string, value: "artifact_scan"}
      type: {key: type, type: string, value: "guard"}
      label: {key: label, type: string, value: "Artifact scan"}
      lane: {key: lane, type: string, value: "validation"}
      position: {key: position, type: object, value: {x: 560, y: 0}}
      handles: {key: handles, type: list, value: ["scan.in", "scan.out"]}
    - id: {key: id, type: string, value: "focused_validation"}
      type: {key: type, type: string, value: "observer"}
      label: {key: label, type: string, value: "Focused proof commands"}
      lane: {key: lane, type: string, value: "proof"}
      position: {key: position, type: object, value: {x: 840, y: 0}}
      handles: {key: handles, type: list, value: ["proof.in", "proof.out"]}
    - id: {key: id, type: string, value: "deploy_guard"}
      type: {key: type, type: string, value: "guard"}
      label: {key: label, type: string, value: "No deploy mutation"}
      lane: {key: lane, type: string, value: "boundary"}
      position: {key: position, type: object, value: {x: 1120, y: 0}}
      handles: {key: handles, type: list, value: ["guard.in"]}
  edges:
    - id: {key: id, type: string, value: "parse_to_route"}
      source: {key: source, type: string, value: "frontmatter_parse"}
      target: {key: target, type: string, value: "route_consistency"}
      type: {key: type, type: string, value: "validation_parse_signal"}
    - id: {key: id, type: string, value: "route_to_scan"}
      source: {key: source, type: string, value: "route_consistency"}
      target: {key: target, type: string, value: "artifact_scan"}
      type: {key: type, type: string, value: "validation_route_signal"}
    - id: {key: id, type: string, value: "scan_to_validation"}
      source: {key: source, type: string, value: "artifact_scan"}
      target: {key: target, type: string, value: "focused_validation"}
      type: {key: type, type: string, value: "validation_proof_signal"}
    - id: {key: id, type: string, value: "validation_to_guard"}
      source: {key: source, type: string, value: "focused_validation"}
      target: {key: target, type: string, value: "deploy_guard"}
      type: {key: type, type: string, value: "validation_proof_signal"}
---

# Validation Runbook

Use focused validation only. Do not run indefinite full-codebase checks for documentation changes.

## Documentation Checks

Resolve repository roots once, then run all checks through those roots:

```bash
AGENTIC_CANVAS_OS_ROOT="$(git rev-parse --show-toplevel)"
GITHUB_ROOT="$(dirname "$AGENTIC_CANVAS_OS_ROOT")"
DOCS_ROOT="$AGENTIC_CANVAS_OS_ROOT/docs"
KNOWGRPH_ROOT="$GITHUB_ROOT/knowgrph"
PROD_MIRROR_ROOT="$GITHUB_ROOT/huijoohwee/content/knowgrph"
MEMORY_ROOT="$AGENTIC_CANVAS_OS_ROOT/memory"
PLANNING_ROOT="$AGENTIC_CANVAS_OS_ROOT/todo"
export AGENTIC_CANVAS_OS_ROOT GITHUB_ROOT DOCS_ROOT KNOWGRPH_ROOT PROD_MIRROR_ROOT MEMORY_ROOT PLANNING_ROOT
find "$DOCS_ROOT" -maxdepth 1 -type f -name '*.md' -print0 | xargs -0 ruby -rdate -ryaml -e 'ARGV.each { |path| text=File.read(path); match=text.match(/\A---\n(.*?)\n---\n/m) or abort("#{path}: missing frontmatter"); YAML.safe_load(match[1], permitted_classes: [Date], aliases: true); puts "#{path}: frontmatter ok" }'
wc -l "$DOCS_ROOT"/*.md
! LC_ALL=C rg -n "[^[:ascii:]]" "$DOCS_ROOT"
ARTIFACT_PATTERN='https?://local'"host"'[:/]|kg_media_'"token"'|data:'"image"'|VIDEO'"DB_API_KEY"'|SENSE'"NOVA_API_KEY"'|generation_'"job_id"'|index_'"job_id"'|upload-'"[0-9a-f]"'|airvio/'"runs"
! rg -n "$ARTIFACT_PATTERN" "$DOCS_ROOT"
EXTERNAL_COPY_PATTERN='hermes-agent/src|agentskills\.io/skills|You are Hermes Agent|kawaii Cute expressions|catgirl Neko|hermes moa preset example|MoA provider config example|GEPA optimizer code|DSPy optimizer code|langgraph/graph\.py|StateGraph example|MessagesState example|deer-flow/backend|deerflow/models|deerflow/sandbox|deerflow config example|tools/tool_search\.py|tests/tools/test_tool_search\.py|openclaw-tool-search-report|tool_search\.py|test_tool_search\.py|prompt_builder\.py|subdirectory_hints\.py|context_references\.py|reference_expander\.py|test_context_references\.py|kanban_runtime\.py|test_kanban\.py'
! (rg -n "$EXTERNAL_COPY_PATTERN" "$DOCS_ROOT" | rg -v 'VALIDATION-RUNBOOK\.md:[0-9]+:EXTERNAL_COPY_PATTERN=')
```

Expected:

- Frontmatter parses for every Markdown file in this folder; missing frontmatter fails.
- Files stay under the local hygiene budget.
- ASCII scan returns no matches unless a source file intentionally requires non-ASCII.
- Runtime artifact scan returns no copied local provider/media artifacts.
- External-copy scan returns no imported code, prompt, preset example, provider config, schema, test, fixture, or prose paths from referenced self-improving agent repositories.

## Repository-Owned Collaboration Gate

Run the complete collaboration and runtime-identity gate from the Agentic Canvas OS repository:

```bash
npm run collaboration:gate
```

This is the only required operator command. It resolves the sibling Knowgrph checkout from the repository root, verifies that Knowgrph still owns `collaboration:readiness:check`, and delegates to that canonical runtime owner. The gate automatically:

1. Runs focused collaboration documentation, protocol, runtime, and MainPanel checks.
2. Reuses healthy local services or boots owner `5173`, guest `5174`, and storage worker `8787` processes.
3. Opens isolated owner and guest browser contexts, authenticates both sessions, and joins the same full document room key.
4. Requires connected two-peer rosters, a worker room status of at least two active peers, remote document propagation, two distinct runtime identities, exact app/docs/catalog revision parity, fresh bounded catalog hydration, and one common verification digest.
5. Emits a machine-readable proof summary, captures owner and guest screenshots on failure, and cleans up services it started.

The automated contexts model two independent collaboration peers; the gate does not require two physical devices. It does not export runtime-identity JSON, require clipboard actions, or accept manually assembled evidence. `Copy diagnostic JSON` remains optional troubleshooting only. A nonzero exit, fewer than two peers, a room-key mismatch, duplicate runtime identity, revision mismatch, stale hydration, different digest, propagation failure, or leaked local process blocks parity and release.

`KNOWGRPH_ROOT` may override sibling discovery for a canonical checkout in a different repository root. There is no `--skip-browser` compliance mode: source-only checks cannot replace the authenticated browser and worker proof.

## Mandatory Completion Gate

After focused validation and protected Dev integration, run from the merged task
branch:

```bash
npm run device:complete -- --json
```

The command must fail for dirty or stashed work, branch-only commits, an open or
auto-merge-pending pull request, a non-`main` pull-request base, a merge commit
absent from fetched `origin/main`, local-main drift, or a dirty final checkout.
Success must emit `completedBranch`, `pullRequestUrl`, `mergeCommitSha`,
`mainSha`, and `"status":"ok"`, with clean local `main` exactly equal to
`origin/main`.

Restart or reload the local application from `mainSha` and rerun the original
browser failure path. Git evidence without matching runtime identity and browser
acceptance is integration evidence, not task completion. Use `device:park` only
for an explicitly paused or blocked task. Do not mutate Prod or Cloudflare
without separate operator authorization.

### Immutable Pair Manifest Compliance

Create the artifact from one exact source object, then validate the downloaded bytes against the same source and pinned docs revisions:

```bash
export KNOWGRPH_SOURCE_REVISION="<exact-knowgrph-sha>"
export KNOWGRPH_TARGET_REF="refs/heads/agent/<device>/<semantic-scope>"
npm --prefix "$KNOWGRPH_ROOT" run release:manifest:create -- \
  --source-sha "$KNOWGRPH_SOURCE_REVISION" \
  --target-ref "$KNOWGRPH_TARGET_REF" \
  --output immutable-release-manifest.json
npm --prefix "$KNOWGRPH_ROOT" run release:manifest:check -- \
  immutable-release-manifest.json \
  --source-sha "$KNOWGRPH_SOURCE_REVISION"
```

CI must upload the generated file, download it into a separate directory, and rerun the checker with the expected app SHA, resolved Agentic Canvas OS SHA, and first-pass manifest digest. A current-worktree report, individually green docs PR, branch name, manually assembled JSON, or unvalidated upload is insufficient.

## Memory Log Compliance Checks

Run the structural gate at session start and again before release:

```bash
ruby -rdate -ryaml -e 'root=ENV.fetch("MEMORY_ROOT"); files=Dir.glob(File.join(root,"[0-9][0-9][0-9][0-9]-[0-9][0-9].md")).sort; abort("memory log has no monthly shard") if files.empty?; files.each do |file|; text=File.read(file); match=text.match(/\A---\n(.*?)\n---\n/m) or abort("#{file}: missing frontmatter"); data=YAML.safe_load(match[1], permitted_classes:[Date], aliases:true); period=File.basename(file,".md"); required={"schema"=>"memory-log/v1","period"=>period,"timestamp_format"=>"YYYYMMDDTHHmmssZ","append_policy"=>"append-only","source_contract"=>"../docs/MEMORY-LOG.md"}; required.each{|key,value| abort("#{file}: invalid #{key}") unless data[key]==value}; %w[agent device].each{|key| abort("#{file}: missing #{key}") unless data[key].is_a?(String) && !data[key].empty?}; body=text[match.end(0)..]; headings=body.scan(/^## (@mem-[0-9]{8}T[0-9]{6}Z)$/).flatten; abort("#{file}: no memory entries") if headings.empty?; headings.each{|heading| begin instant=DateTime.strptime(heading.delete_prefix("@mem-"),"%Y%m%dT%H%M%SZ"); rescue Date::Error; abort("#{file}: invalid UTC memory timestamp #{heading}"); end; abort("#{file}: timestamp month mismatch #{heading}") unless instant.strftime("%Y-%m")==period}; abort("#{file}: duplicate or unordered memory headings") unless headings.uniq==headings && headings.sort==headings; abort("#{file}: non-sigil memory source format") if body.match?(/^## .*@mem-/) && body.scan(/^## .*@mem-/).length!=headings.length || body.match?(/^\|.*@mem-/); entries=body.split(/^## @mem-[^\n]+\n/).drop(1); entries.each{|entry| %w[type scope summary refs].each{|field| abort("#{file}: missing #{field}") unless entry.scan(/^#{field}:/).length==1}; abort("#{file}: refs must be a Markdown array") unless entry.match?(/^refs:\s*\[[^\]]+\]\s*$/)}; puts "#{file}: memory-log structure ok"; end'
```

Before release, compare every existing shard with the exact memory base ref recorded by `START-WORKFLOW.md`:

```bash
export MEMORY_BASE_REF="<recorded-agentic-canvas-os-base-sha>"
ruby -ropen3 -e 'root=ENV.fetch("AGENTIC_CANVAS_OS_ROOT"); base=ENV.fetch("MEMORY_BASE_REF"); listed,status=Open3.capture2("git","-C",root,"ls-tree","-r","--name-only",base,"--","memory"); abort("cannot read memory base ref") unless status.success?; base_files=listed.lines.map(&:strip).grep(%r{\Amemory/[0-9]{4}-[0-9]{2}\.md\z}); current=Dir.glob(File.join(root,"memory","[0-9][0-9][0-9][0-9]-[0-9][0-9].md")).map{|file| file.delete_prefix(root+"/")}; missing=base_files-current; abort("deleted memory shards: #{missing.join(", ")}") unless missing.empty?; base_files.each do |relative|; prior,status=Open3.capture2("git","-C",root,"show","#{base}:#{relative}"); abort("cannot read #{relative} at base") unless status.success?; now=File.binread(File.join(root,relative)); abort("#{relative}: historical bytes changed or content inserted before EOF") unless now.start_with?(prior); end; puts "memory-log append-only diff ok"'
```

Expected:

- Every shard uses `memory-log/v1` frontmatter, `timestamp_format: YYYYMMDDTHHmmssZ`, and exact `## @mem-YYYYMMDDTHHmmssZ` UTC blocks.
- Every entry has exactly one `type`, `scope`, `summary`, and Markdown-array `refs` field.
- Local-time, offset, minute-only, hyphenated, impossible-date, wrong-month, pure-YAML, Markdown-table, bolded, duplicate, and timestamp-reordered entries fail.
- Existing shards preserve every byte from the recorded base and add content only at EOF; deleted shards fail.
- A new monthly shard is allowed only when its filename, `period`, identity, policy, source contract, and first entry validate.

## Planning Shard Compliance Checks

Run the structural gate at session start and again before release:

```bash
ruby -rdate -ryaml <<'RUBY'
root = ENV.fetch("PLANNING_ROOT")
index_path = File.expand_path("../docs/TODO.md", root)
index_text = File.read(index_path)
index_match = index_text.match(/\A---\n(.*?)\n---\n/m) or abort("TODO.md: missing frontmatter")
index = YAML.safe_load(index_match[1], permitted_classes: [Date], aliases: true)
abort("TODO.md: invalid schema") unless index["schema"] == "todo-index/v1"
abort("TODO.md: invalid append policy") unless index["append_policy"] == "append-only"

active_path = File.expand_path(index.fetch("active_shard"), File.dirname(index_path))
files = Dir.glob(File.join(root, "[0-9][0-9][0-9][0-9]-[0-9][0-9].md")).sort
abort("todo: no monthly shards") if files.empty?
abort("todo: active shard missing") unless files.include?(active_path)

strict_contexts = []
files.each do |file|
  text = File.read(file)
  match = text.match(/\A---\n(.*?)\n---\n/m) or abort("#{file}: missing frontmatter")
  data = YAML.safe_load(match[1], permitted_classes: [Date], aliases: true)
  period = File.basename(file, ".md")
  required = {
    "schema" => "todo-log/v1",
    "period" => period,
    "scope" => "cross-repository",
    "status" => "append-only",
    "append_policy" => "append-only",
    "date_heading_format" => "YYYY-MM-DD",
    "source_contract" => "../docs/TODO.md",
    "adoption_date" => index.fetch("adoption_date")
  }
  required.each { |key, value| abort("#{file}: invalid #{key}") unless data[key] == value }
  abort("#{file}: byte cap exceeded") unless File.size(file) < index.fetch("size_limit_bytes")
  abort("#{file}: line cap exceeded") unless text.lines.length <= index.fetch("line_limit")

  body = text[match.end(0)..]
  headings = body.scan(/^## ([0-9]{4}-[0-9]{2}-[0-9]{2})$/).flatten
  abort("#{file}: no dated sections") if headings.empty?
  abort("#{file}: duplicate or unordered dates") unless headings.uniq == headings && headings.sort == headings
  headings.each do |heading|
    Date.iso8601(heading)
    abort("#{file}: heading month mismatch #{heading}") unless heading.start_with?(period + "-")
  end
  header = "| Context | Intent | Directive | Module | Class/Object | Function/Method | Input | Output | Decision Logic | Next Step Recommendation | Updated Date |"
  separator = "|--------|--------|-----------|--------|-----------------|-------|--------|----------------|--------------------------|--------------------------|--------------|"
  sections = body.scan(/^## [0-9]{4}-[0-9]{2}-[0-9]{2}\n.*?(?=^## [0-9]{4}-[0-9]{2}-[0-9]{2}\n|\z)/m)
  abort("#{file}: dated table missing") unless sections.length == headings.length && sections.all? { |section_text| section_text.lines.any? { |line| line.chomp == header } && section_text.lines.any? { |line| line.chomp == separator } }

  section = nil
  body.each_line do |line|
    if line =~ /^## ([0-9]{4}-[0-9]{2}-[0-9]{2})$/
      section = Regexp.last_match(1)
      next
    end
    next unless section && section >= index.fetch("adoption_date")
    next unless line.start_with?("| ")
    cells = line.strip.split("|", -1)[1...-1].map(&:strip)
    next if cells.first == "Context"
    abort("#{file}: strict row must have 11 cells") unless cells.length == 11
    abort("#{file}: strict row has empty or placeholder cells") if cells.any? { |cell| cell.empty? || cell == "-" }
    directive_words = cells[2].split(/\s+/).length
    abort("#{file}: strict Directive exceeds 50 words") if directive_words > 50
    abort("#{file}: strict Updated Date mismatch") unless cells[10] == section
    strict_contexts << cells.first
  end
  puts "#{file}: planning shard structure ok"
end
abort("todo: no strict planning rows") if strict_contexts.empty?
abort("todo: duplicate strict Context") unless strict_contexts.uniq.length == strict_contexts.length
RUBY
```

Before release, compare committed shard prefixes and validate the declared task row:

```bash
export PLANNING_BASE_REF="<recorded-agentic-canvas-os-base-sha>"
export PLANNING_SHARD="todo/<utc-year-month>.md"
export PLANNING_CONTEXT="<exact-cross-repository-task-context>"
ruby -rdate -ropen3 -ryaml <<'RUBY'
root = ENV.fetch("AGENTIC_CANVAS_OS_ROOT")
base = ENV.fetch("PLANNING_BASE_REF")
relative = ENV.fetch("PLANNING_SHARD")
context = ENV.fetch("PLANNING_CONTEXT")
abort("todo: unsafe planning shard") unless relative.match?(%r{\Atodo/[0-9]{4}-[0-9]{2}\.md\z})
abort("todo: empty or unsafe Context") if context.empty? || context.include?("|")
index_text = File.read(File.join(root, "docs", "TODO.md"))
index_match = index_text.match(/\A---\n(.*?)\n---\n/m) or abort("TODO.md: missing frontmatter")
index = YAML.safe_load(index_match[1], permitted_classes: [Date], aliases: true)
active_relative = File.expand_path(index.fetch("active_shard"), File.join(root, "docs")).delete_prefix(root + "/")
abort("todo: declared shard is not active") unless relative == active_relative

listed, status = Open3.capture2("git", "-C", root, "ls-tree", "-r", "--name-only", base, "--", "todo")
abort("todo: cannot read planning base ref") unless status.success?
base_files = listed.lines.map(&:strip).grep(%r{\Atodo/[0-9]{4}-[0-9]{2}\.md\z})
current_files = Dir.glob(File.join(root, "todo", "[0-9][0-9][0-9][0-9]-[0-9][0-9].md")).map { |file| file.delete_prefix(root + "/") }
missing = base_files - current_files
abort("todo: deleted planning shards: #{missing.join(", ")}") unless missing.empty?
base_files.each do |base_file|
  prior, read_status = Open3.capture2("git", "-C", root, "show", "#{base}:#{base_file}")
  abort("todo: cannot read #{base_file} at base") unless read_status.success?
  now = File.binread(File.join(root, base_file))
  abort("#{base_file}: historical bytes changed or content inserted before EOF") unless now.start_with?(prior.b)
end

path = File.join(root, relative)
section = nil
matches = []
File.foreach(path) do |line|
  section = Regexp.last_match(1) if line =~ /^## ([0-9]{4}-[0-9]{2}-[0-9]{2})$/
  next unless line.start_with?("| ")
  cells = line.strip.split("|", -1)[1...-1].map(&:strip)
  next if cells.first == "Context"
  matches << [line, section, cells] if cells.first == context
end
abort("todo: planning Context must occur exactly once") unless matches.length == 1
line, section, cells = matches.first
abort("todo: planning row must have 11 cells") unless cells.length == 11
abort("todo: planning row has empty or placeholder cells") if cells.any? { |cell| cell.empty? || cell == "-" }
words = cells[2].split(/\s+/).length
abort("todo: planning Directive exceeds 50 words") if words > 50
Date.iso8601(cells[10])
abort("todo: planning Updated Date mismatch") unless cells[10] == section
abort("todo: planning row predates adoption boundary") unless section >= index.fetch("adoption_date")
if base_files.include?(relative)
  prior = Open3.capture2("git", "-C", root, "show", "#{base}:#{relative}").first
  abort("todo: declared planning row was not appended") if prior.lines.include?(line)
end
puts "planning row ok: context=#{context} directive_words=#{words}"
RUBY
```

Expected:

- `TODO.md` stays the bounded index; rows live only in monthly shards.
- Each shard matches its filename, scope, lifecycle, UTC month, chronological ordering, and size caps.
- Pre-adoption rows remain byte-preserved history; strict validation applies to rows at or after `2026-07-14`.
- Every shard present at the recorded base remains an exact byte prefix; deleted, edited, reordered, or prepended history fails.
- Release finds one new declared planning Context with 11 filled cells, a Directive of at most 50 words, and a matching Updated Date.

## Route Consistency Checks

Run from `$GITHUB_ROOT`:

```bash
ruby -ryaml -e 'root=ENV.fetch("DOCS_ROOT"); read=->(name){File.read(File.join(root,name))}; parse=->(name){YAML.safe_load(read.call(name).match(/\A---\n(.*?)\n---\n/m)[1], aliases: true)}; command=parse.call("DICTIONARY-COMMAND.md").fetch("dictionary_entries"); semantic=parse.call("DICTIONARY-SEMANTIC.md").fetch("dictionary_entries"); binding=parse.call("DICTIONARY-BINDING.md").fetch("dictionary_entries"); skills=parse.call("SKILLS.md"); body=read.call("SKILLS.md"); missing=(command+semantic+binding+skills.fetch("skill_contracts")+skills.fetch("skill_variants")).reject{|entry| body.include?(entry) || read.call("DICTIONARY-COMMAND.md").include?(entry) || read.call("DICTIONARY-SEMANTIC.md").include?(entry) || read.call("DICTIONARY-BINDING.md").include?(entry)}; abort("missing route coverage: #{missing.join(", ")}") unless missing.empty?; puts "route consistency ok"'
ruby -ryaml -e 'root=ENV.fetch("DOCS_ROOT"); parse=->(name){text=File.read(File.join(root,name)); YAML.safe_load(text.match(/\A---\n(.*?)\n---\n/m)[1], aliases: true)}; facts=parse.call("FACTS.md").fetch("direct_resolution"); dictionaries={"/"=>parse.call("DICTIONARY-COMMAND.md").fetch("dictionary_entries"), "#"=>parse.call("DICTIONARY-SEMANTIC.md").fetch("dictionary_entries"), "@"=>parse.call("DICTIONARY-BINDING.md").fetch("dictionary_entries")}; missing=facts.keys.reject{|token| dictionaries.fetch(token[0]).include?(token)}; abort("missing facts direct resolution: #{missing.join(", ")}") unless missing.empty?; puts "facts direct resolution ok"'
ruby -ryaml -e 'root=ENV.fetch("DOCS_ROOT"); parse=->(name){text=File.read(File.join(root,name)); YAML.safe_load(text.match(/\A---\n(.*?)\n---\n/m)[1], aliases: true)}; command=parse.call("DICTIONARY-COMMAND.md").fetch("dictionary_entries"); semantic=parse.call("DICTIONARY-SEMANTIC.md").fetch("dictionary_entries"); binding=parse.call("DICTIONARY-BINDING.md").fetch("dictionary_entries"); skills=parse.call("SKILLS.md"); soul=parse.call("SOUL.md"); required_commands=%w[/soul.load /personality.overlay]; required_semantics=%w[#soul #primary-identity #personality-overlay]; required_bindings=%w[@soul-profile @identity-slot @personality-overlay]; required_skills=%w[soul.load personality.overlay]; missing=required_commands.reject{|x| command.include?(x)}+required_semantics.reject{|x| semantic.include?(x)}+required_bindings.reject{|x| binding.include?(x)}+required_skills.reject{|x| skills.fetch("skill_contracts").include?(x)}; abort("missing soul route coverage: #{missing.join(", ")}") unless missing.empty?; abort("soul prompt slot not 1") unless soul.dig("soul_contract","prompt_slot")==1; puts "soul route consistency ok"'
ruby -ryaml -e 'root=ENV.fetch("DOCS_ROOT"); parse=->(name){text=File.read(File.join(root,name)); YAML.safe_load(text.match(/\A---\n(.*?)\n---\n/m)[1], aliases: true)}; command=parse.call("DICTIONARY-COMMAND.md").fetch("dictionary_entries"); semantic=parse.call("DICTIONARY-SEMANTIC.md").fetch("dictionary_entries"); binding=parse.call("DICTIONARY-BINDING.md").fetch("dictionary_entries"); skills=parse.call("SKILLS.md"); user=parse.call("USER.md"); memory=parse.call("MEMORY.md"); required_commands=%w[/memory.write /memory.compact /memory.search /session.search /user.profile]; required_semantics=%w[#persistent-memory #user-profile #frozen-snapshot #memory-capacity #session-search #memory-search]; required_bindings=%w[@memory-store @memory-entry @memory-snapshot @memory-policy @user-profile @session-index]; required_skills=%w[memory.write memory.compact memory.search session.search user.profile]; missing=required_commands.reject{|x| command.include?(x)}+required_semantics.reject{|x| semantic.include?(x)}+required_bindings.reject{|x| binding.include?(x)}+required_skills.reject{|x| skills.fetch("skill_contracts").include?(x)}; abort("missing persistent-memory route coverage: #{missing.join(", ")}") unless missing.empty?; abort("user profile limit missing") unless user.dig("user_profile_contract","limit_chars").is_a?(Integer); abort("memory targets missing") unless memory.dig("agentic_os_memory","persistent_memory","targets","memory","limit_chars").is_a?(Integer); puts "persistent-memory route consistency ok"'
ruby -ryaml -e 'root=ENV.fetch("DOCS_ROOT"); parse=->(name){text=File.read(File.join(root,name)); YAML.safe_load(text.match(/\A---\n(.*?)\n---\n/m)[1], aliases: true)}; command=parse.call("DICTIONARY-COMMAND.md").fetch("dictionary_entries"); semantic=parse.call("DICTIONARY-SEMANTIC.md").fetch("dictionary_entries"); binding=parse.call("DICTIONARY-BINDING.md").fetch("dictionary_entries"); skills=parse.call("SKILLS.md"); memory=parse.call("MEMORY.md"); required_commands=%w[/skill.discover /skill.load /skill.bundle /skill.manage /skill.propose /skill.evolve]; required_semantics=%w[#skill-system #progressive-disclosure #skill-bundle #agentskills-compatible #skill-security #skill-evolution]; required_bindings=%w[@skill-index @skill-source @skill-reference @skill-bundle @skill-policy @skill-catalog]; required_skills=%w[skill.discover skill.load skill.bundle skill.manage skill.propose skill.evolve]; missing=required_commands.reject{|x| command.include?(x)}+required_semantics.reject{|x| semantic.include?(x)}+required_bindings.reject{|x| binding.include?(x)}+required_skills.reject{|x| skills.fetch("skill_contracts").include?(x)}; abort("missing skill-system route coverage: #{missing.join(", ")}") unless missing.empty?; abort("skill system memory missing") unless memory.dig("agentic_os_memory","skill_system","commands").is_a?(Array); puts "skill-system route consistency ok"'
ruby -ryaml -e 'root=ENV.fetch("DOCS_ROOT"); parse=->(name){text=File.read(File.join(root,name)); YAML.safe_load(text.match(/\A---\n(.*?)\n---\n/m)[1], aliases: true)}; command=parse.call("DICTIONARY-COMMAND.md").fetch("dictionary_entries"); semantic=parse.call("DICTIONARY-SEMANTIC.md").fetch("dictionary_entries"); binding=parse.call("DICTIONARY-BINDING.md").fetch("dictionary_entries"); skills=parse.call("SKILLS.md"); memory=parse.call("MEMORY.md"); required_commands=%w[/context.discover /context.load /context.audit]; required_semantics=%w[#context-file #project-context #cwd-discovery]; required_bindings=%w[@context-file @working-directory @context-policy]; required_skills=%w[context.discover context.load context.audit]; missing=required_commands.reject{|x| command.include?(x)}+required_semantics.reject{|x| semantic.include?(x)}+required_bindings.reject{|x| binding.include?(x)}+required_skills.reject{|x| skills.fetch("skill_contracts").include?(x)}; abort("missing context-file route coverage: #{missing.join(", ")}") unless missing.empty?; abort("context files memory missing") unless memory.dig("agentic_os_memory","context_files","commands").is_a?(Array); puts "context-files route consistency ok"'
ruby -ryaml -e 'root=ENV.fetch("DOCS_ROOT"); parse=->(name){text=File.read(File.join(root,name)); YAML.safe_load(text.match(/\A---\n(.*?)\n---\n/m)[1], aliases: true)}; command=parse.call("DICTIONARY-COMMAND.md").fetch("dictionary_entries"); semantic=parse.call("DICTIONARY-SEMANTIC.md").fetch("dictionary_entries"); binding=parse.call("DICTIONARY-BINDING.md").fetch("dictionary_entries"); skills=parse.call("SKILLS.md"); memory=parse.call("MEMORY.md"); required_commands=%w[/reference.expand /reference.audit]; required_semantics=%w[#context-reference #inline-context #attached-context]; required_bindings=%w[@file: @folder: @diff @staged @git: @url: @reference-policy @attached-context]; required_skills=%w[reference.expand reference.audit]; missing=required_commands.reject{|x| command.include?(x)}+required_semantics.reject{|x| semantic.include?(x)}+required_bindings.reject{|x| binding.include?(x)}+required_skills.reject{|x| skills.fetch("skill_contracts").include?(x)}; abort("missing context-reference route coverage: #{missing.join(", ")}") unless missing.empty?; abort("context references memory missing") unless memory.dig("agentic_os_memory","context_references","commands").is_a?(Array); puts "context-references route consistency ok"'
ruby -ryaml -e 'root=ENV.fetch("DOCS_ROOT"); parse=->(name){text=File.read(File.join(root,name)); YAML.safe_load(text.match(/\A---\n(.*?)\n---\n/m)[1], aliases: true)}; command=parse.call("DICTIONARY-COMMAND.md").fetch("dictionary_entries"); semantic=parse.call("DICTIONARY-SEMANTIC.md").fetch("dictionary_entries"); binding=parse.call("DICTIONARY-BINDING.md").fetch("dictionary_entries"); skills=parse.call("SKILLS.md"); memory=parse.call("MEMORY.md"); board=parse.call("kanban.md"); required_commands=%w[/kanban.task /kanban.handoff /kanban.sync]; required_semantics=%w[#kanban-board #task-row #profile-handoff #worker-process #multi-agent-collaboration]; required_bindings=%w[@kanban-board @task-row @handoff-row @agent-profile @worker-process]; required_skills=%w[kanban.collaborate]; missing=required_commands.reject{|x| command.include?(x)}+required_semantics.reject{|x| semantic.include?(x)}+required_bindings.reject{|x| binding.include?(x)}+required_skills.reject{|x| skills.fetch("skill_contracts").include?(x)}; abort("missing kanban route coverage: #{missing.join(", ")}") unless missing.empty?; abort("kanban memory missing") unless memory.dig("agentic_os_memory","kanban_collaboration","commands").is_a?(Array); abort("kanban columns missing") unless board.dig("kanban_contract","required_columns").is_a?(Array); puts "kanban route consistency ok"'
ruby -ryaml -e 'root=ENV.fetch("DOCS_ROOT"); parse=->(name){text=File.read(File.join(root,name)); YAML.safe_load(text.match(/\A---\n(.*?)\n---\n/m)[1], aliases: true)}; command=parse.call("DICTIONARY-COMMAND.md").fetch("dictionary_entries"); semantic=parse.call("DICTIONARY-SEMANTIC.md").fetch("dictionary_entries"); binding=parse.call("DICTIONARY-BINDING.md").fetch("dictionary_entries"); skills=parse.call("SKILLS.md"); memory=parse.call("MEMORY.md"); required_commands=%w[/tool.catalog /tool.route /tool.provider.select /tool.gateway.audit]; required_semantics=%w[#tool-gateway #tool-routing #web-search #image-generation #text-to-speech #cloud-browser]; required_bindings=%w[@tool-gateway @tool-provider @web-search-tool @image-tool @tts-tool @browser-tool @tool-policy]; required_skills=%w[tool.catalog tool.route tool.provider.select tool.gateway.audit]; missing=required_commands.reject{|x| command.include?(x)}+required_semantics.reject{|x| semantic.include?(x)}+required_bindings.reject{|x| binding.include?(x)}+required_skills.reject{|x| skills.fetch("skill_contracts").include?(x)}; abort("missing tool-gateway route coverage: #{missing.join(", ")}") unless missing.empty?; abort("tool gateway memory missing") unless memory.dig("agentic_os_memory","tool_gateway","commands").is_a?(Array); puts "tool-gateway route consistency ok"'
ruby -ryaml -e 'root=ENV.fetch("DOCS_ROOT"); parse=->(name){text=File.read(File.join(root,name)); YAML.safe_load(text.match(/\A---\n(.*?)\n---\n/m)[1], aliases: true)}; command=parse.call("DICTIONARY-COMMAND.md").fetch("dictionary_entries"); semantic=parse.call("DICTIONARY-SEMANTIC.md").fetch("dictionary_entries"); binding=parse.call("DICTIONARY-BINDING.md").fetch("dictionary_entries"); skills=parse.call("SKILLS.md"); memory=parse.call("MEMORY.md"); required_commands=%w[/tool.catalog /toolset.enable /toolset.disable]; required_semantics=%w[#tool-function #toolset #platform-toolset]; required_bindings=%w[@tool-function @toolset @platform-surface @tool-policy]; required_skills=%w[tool.catalog toolset.enable toolset.disable]; missing=required_commands.reject{|x| command.include?(x)}+required_semantics.reject{|x| semantic.include?(x)}+required_bindings.reject{|x| binding.include?(x)}+required_skills.reject{|x| skills.fetch("skill_contracts").include?(x)}; abort("missing tools-and-toolsets route coverage: #{missing.join(", ")}") unless missing.empty?; abort("tool gateway memory missing toolset state") unless memory.dig("agentic_os_memory","tool_gateway","commands").include?("/toolset.enable"); puts "tools-and-toolsets route consistency ok"'
ruby -ryaml -e 'root=ENV.fetch("DOCS_ROOT"); parse=->(name){text=File.read(File.join(root,name)); YAML.safe_load(text.match(/\A---\n(.*?)\n---\n/m)[1], aliases: true)}; command=parse.call("DICTIONARY-COMMAND.md").fetch("dictionary_entries"); semantic=parse.call("DICTIONARY-SEMANTIC.md").fetch("dictionary_entries"); binding=parse.call("DICTIONARY-BINDING.md").fetch("dictionary_entries"); skills=parse.call("SKILLS.md"); memory=parse.call("MEMORY.md"); required_commands=%w[/tool.search /tool.describe /tool.call]; required_semantics=%w[#tool-search #deferred-tool-schema #bridge-tool]; required_bindings=%w[@deferred-tool-catalog @bridge-tool @tool-policy]; required_skills=%w[tool.search tool.describe tool.call]; missing=required_commands.reject{|x| command.include?(x)}+required_semantics.reject{|x| semantic.include?(x)}+required_bindings.reject{|x| binding.include?(x)}+required_skills.reject{|x| skills.fetch("skill_contracts").include?(x)}; abort("missing tool-search route coverage: #{missing.join(", ")}") unless missing.empty?; abort("tool search memory missing") unless memory.dig("agentic_os_memory","tool_search","commands").is_a?(Array); puts "tool-search route consistency ok"'
ruby -ryaml -e 'root=ENV.fetch("DOCS_ROOT"); parse=->(name){text=File.read(File.join(root,name)); YAML.safe_load(text.match(/\A---\n(.*?)\n---\n/m)[1], aliases: true)}; command=parse.call("DICTIONARY-COMMAND.md").fetch("dictionary_entries"); semantic=parse.call("DICTIONARY-SEMANTIC.md").fetch("dictionary_entries"); binding=parse.call("DICTIONARY-BINDING.md").fetch("dictionary_entries"); skills=parse.call("SKILLS.md"); required_commands=%w[/moa]; required_semantics=%w[#mixture-of-agents #reference-agents #aggregator-agent]; required_bindings=%w[@moa-preset @reference-agents @aggregator-agent]; required_skills=%w[moa.run agent.moa]; missing=required_commands.reject{|x| command.include?(x)}+required_semantics.reject{|x| semantic.include?(x)}+required_bindings.reject{|x| binding.include?(x)}+required_skills.reject{|x| skills.fetch("skill_contracts").include?(x) || skills.fetch("skill_variants").include?(x)}; abort("missing moa route coverage: #{missing.join(", ")}") unless missing.empty?; puts "moa route consistency ok"'
ruby -ryaml -e 'root=ENV.fetch("DOCS_ROOT"); parse=->(name){text=File.read(File.join(root,name)); YAML.safe_load(text.match(/\A---\n(.*?)\n---\n/m)[1], aliases: true)}; command=parse.call("DICTIONARY-COMMAND.md").fetch("dictionary_entries"); semantic=parse.call("DICTIONARY-SEMANTIC.md").fetch("dictionary_entries"); binding=parse.call("DICTIONARY-BINDING.md").fetch("dictionary_entries"); skills=parse.call("SKILLS.md"); required_commands=%w[/memory.search /experience.capture /skill.propose /skill.evolve /identity.reflect]; required_semantics=%w[#learning-loop #skill-evolution #memory-search #identity-model]; required_bindings=%w[@experience @memory-store @skill-catalog @identity-model]; required_skills=%w[experience.capture memory.search skill.propose skill.evolve identity.reflect agent.learning]; missing=required_commands.reject{|x| command.include?(x)}+required_semantics.reject{|x| semantic.include?(x)}+required_bindings.reject{|x| binding.include?(x)}+required_skills.reject{|x| skills.fetch("skill_contracts").include?(x) || skills.fetch("skill_variants").include?(x)}; abort("missing learning-loop route coverage: #{missing.join(", ")}") unless missing.empty?; puts "learning-loop route consistency ok"'
	ruby -ryaml -e 'root=ENV.fetch("DOCS_ROOT"); parse=->(name){text=File.read(File.join(root,name)); YAML.safe_load(text.match(/\A---\n(.*?)\n---\n/m)[1], aliases: true)}; command=parse.call("DICTIONARY-COMMAND.md").fetch("dictionary_entries"); semantic=parse.call("DICTIONARY-SEMANTIC.md").fetch("dictionary_entries"); binding=parse.call("DICTIONARY-BINDING.md").fetch("dictionary_entries"); skills=parse.call("SKILLS.md"); required_commands=%w[/orchestration.graph /state.checkpoint /human.review /stream.trace]; required_semantics=%w[#orchestration-graph #stateful-agent #durable-execution #human-in-loop]; required_bindings=%w[@orchestration-graph @state-store @checkpoint-store @human-review]; required_skills=%w[orchestration.graph state.checkpoint human.review stream.trace agent.orchestrator]; missing=required_commands.reject{|x| command.include?(x)}+required_semantics.reject{|x| semantic.include?(x)}+required_bindings.reject{|x| binding.include?(x)}+required_skills.reject{|x| skills.fetch("skill_contracts").include?(x) || skills.fetch("skill_variants").include?(x)}; abort("missing orchestration route coverage: #{missing.join(", ")}") unless missing.empty?; puts "orchestration route consistency ok"'
	ruby -ryaml -e 'root=ENV.fetch("DOCS_ROOT"); parse=->(name){text=File.read(File.join(root,name)); YAML.safe_load(text.match(/\A---\n(.*?)\n---\n/m)[1], aliases: true)}; command=parse.call("DICTIONARY-COMMAND.md").fetch("dictionary_entries"); semantic=parse.call("DICTIONARY-SEMANTIC.md").fetch("dictionary_entries"); binding=parse.call("DICTIONARY-BINDING.md").fetch("dictionary_entries"); skills=parse.call("SKILLS.md"); required_commands=%w[/superagent.run]; required_semantics=%w[#long-horizon-harness #sandboxed-workspace #message-gateway]; required_bindings=%w[@sandbox-workspace @message-gateway]; required_skills=%w[superagent.run]; missing=required_commands.reject{|x| command.include?(x)}+required_semantics.reject{|x| semantic.include?(x)}+required_bindings.reject{|x| binding.include?(x)}+required_skills.reject{|x| skills.fetch("skill_contracts").include?(x)}; abort("missing superagent route coverage: #{missing.join(", ")}") unless missing.empty?; puts "superagent route consistency ok"'
```

Expected:

- Command, semantic, binding, skill, and variant entries are discoverable from the source docs.
- Every `FACTS.md` `direct_resolution` token is present in the matching `/`, `#`, or `@` dictionary.
- `/soul.load`, `/personality.overlay`, Soul tags, Soul bindings, `soul.load`, and `personality.overlay` route through dictionaries, `SOUL.md`, and `SKILLS.md`.
- `/memory.write`, `/memory.compact`, `/memory.search`, `/session.search`, `/user.profile`, persistent-memory tags, memory bindings, and matching skills route through dictionaries, `MEMORY.md`, `USER.md`, and `SKILLS.md`.
- `/skill.discover`, `/skill.load`, `/skill.bundle`, `/skill.manage`, skill-system tags, skill bindings, and matching skills route through dictionaries, `MEMORY.md`, and `SKILLS.md`.
- `/context.discover`, `/context.load`, `/context.audit`, context-file tags, working-directory bindings, policy bindings, and matching skills route through dictionaries, `MEMORY.md`, and `SKILLS.md`.
- `/reference.expand`, `/reference.audit`, context-reference tags, reference bindings, attached-context packets, and matching skills route through dictionaries, `MEMORY.md`, and `SKILLS.md`.
- `/kanban.task`, `/kanban.handoff`, `/kanban.sync`, Kanban tags, board bindings, row bindings, profile bindings, and `kanban.collaborate` route through dictionaries, `MEMORY.md`, `SKILLS.md`, and `kanban.md`.
- `/tool.catalog`, `/tool.route`, `/tool.provider.select`, `/tool.gateway.audit`, tool gateway tags, tool bindings, and matching skills route through dictionaries, `MEMORY.md`, and `SKILLS.md`.
- `/tool.catalog`, `/toolset.enable`, `/toolset.disable`, tool-function tags, toolset tags, platform-surface bindings, and matching skills route through dictionaries, `MEMORY.md`, and `SKILLS.md`.
- `/tool.search`, `/tool.describe`, `/tool.call`, tool-search tags, deferred-schema tags, bridge bindings, and matching skills route through dictionaries, `MEMORY.md`, and `SKILLS.md`.
- `/moa`, MoA tags, MoA bindings, `moa.run`, and `agent.moa` route through dictionaries and `SKILLS.md`.
- `/memory.search`, `/experience.capture`, `/skill.propose`, `/skill.evolve`, `/identity.reflect`, learning tags, learning bindings, and `agent.learning` route through dictionaries and `SKILLS.md`.
- `/orchestration.graph`, `/state.checkpoint`, `/human.review`, `/stream.trace`, orchestration tags, orchestration bindings, and `agent.orchestrator` route through dictionaries and `SKILLS.md`.
- `/superagent.run`, long-horizon tags, sandbox/message bindings, and `superagent.run` route through dictionaries and `SKILLS.md`.
- `/computing-flow`, `#computing-flow`, and `flow.computing` route through KGC/frontmatter contracts.
- No entry requires a FloatingPanel-only duplicate registry.

## Knowgrph Local Runtime Checks

Run only when a runtime owner in `$KNOWGRPH_ROOT` is touched:

```bash
npm -C "$KNOWGRPH_ROOT" run vdeoxpln:check
npm -C "$KNOWGRPH_ROOT/canvas" run test:ci:unit -- mcpLocalToolContract
npm -C "$KNOWGRPH_ROOT/canvas" run test:ci:unit -- vdeoxplnContract
npm -C "$KNOWGRPH_ROOT/canvas" run typecheck
```

Choose the subset matching touched owners. Do not run broader suites unless the change crosses shared contracts or compiler boundaries.

## Agentic OS VCC Checks

Run the focused writer-coordination proof before any broader docs or build check:

```sh
node --test __tests__/writer-lease-lib.test.mjs __tests__/repository-guards.test.mjs __tests__/device-branch-lib.test.mjs
```

The proof must show one atomic local writer, increasing epochs after expiry, bounded heartbeat renewal, session and branch fencing, different-scope pull-request coexistence, duplicate-scope rejection, and a draft ownership pull request created before normal authoring.

| Capability | Focused check |
|---|---|
| Capability discovery | Tool catalog test exits 0 and reports deduplicated tool ids. |
| Automated collaboration and runtime identity | `npm run collaboration:gate` exits zero after focused checks and isolated owner/guest/worker proof; the result reports at least two active peers, remote document propagation, two distinct runtime identities, one common digest, identical exact Knowgrph, Agentic Canvas OS, and catalog SHAs, and `fresh` hydration within two attempts. Physical devices and JSON exports are not required. |
| Multi-chat writer coordination | Focused writer-lease, repository-guard, and device-branch tests exit zero; same-device competing sessions and duplicate active scopes fail, while different scopes coexist and heartbeat extends only the owning session's bounded lease. |
| OS status read views | Status runtime test exits 0 and state-source before/after diff is empty. |
| Cost summary | Cost schema validation exits 0 and read-only views report zero. |
| Gate catalog | Approval schema tests pass and missing approval blocks spend. |
| Video Remix Director | Missing approvals produce blocked zero-cost manifest; approved dry-run emits storyboard evidence. |
| Canvas dashboard | Frontmatter parses; KGC graph materializes through existing Source Files/Canvas owners. |
| Agentic OS slash dictionary | `npm -C "$KNOWGRPH_ROOT/canvas" run test:ci:unit -- ui.floatingPanelChat.composer.memoryInvocationRuntime` exits 0. |
| FloatingPanel Chat action recommendation | `npm -C "$KNOWGRPH_ROOT/canvas" run test:ci:unit -- ui.floatingPanelChat.pipeline`, `ui.floatingPanelChat.quickActions.invocationRoutes`, `ui.floatingPanelChat.composer.ingestCommandRegistry`, and `ui.floatingPanelChat.composer.slashVariableMenus` exit 0. |
| Soul identity | Focused docs route check reports `soul route consistency ok`; implementation proof remains gated until a touched `knowgrph` owner exposes prompt slot 1 assembly, scan, bounds, typed fallback, and no-hardcoded-default rejection. |
| Mixture of Agents | Focused docs route check reports `moa route consistency ok`; implementation proof remains gated until a touched `knowgrph` owner exposes preset resolution, reference fan-out, aggregator action, separated cost logs, and no-recursion rejection. |
| Persistent memory | Focused docs route check reports `persistent-memory route consistency ok`; implementation proof remains gated until a touched `knowgrph` owner exposes bounded memory/profile targets, frozen snapshot reads, typed capacity errors, scan, and session search. |
| Skills system | Focused docs route check reports `skill-system route consistency ok`; implementation proof remains gated until a touched `knowgrph` owner exposes metadata discovery, selected source load, resource load, bundle resolution, scan, validation, and write approval policy. |
| Context files | Focused docs route check reports `context-files route consistency ok`; implementation proof remains gated until a touched `knowgrph` owner exposes working-directory discovery, scanned load, truncation, progressive hints, and context audit proof. |
| Context references | Focused docs route check reports `context-references route consistency ok`; implementation proof remains gated until a touched `knowgrph` owner exposes typed expansion packets, warnings, refusals, source metadata, and unsupported-surface behavior. |
| Kanban collaboration | Focused docs route check reports `kanban route consistency ok`; implementation proof remains gated until a touched `knowgrph` owner exposes row validation, table/Kanban projection, profile binding, worker-process proof, and sync conflicts. |
| Tools and toolsets | Focused docs route check reports `tools-and-toolsets route consistency ok`; implementation proof remains gated until a touched `knowgrph` owner exposes tool function catalog, toolset state, platform scope, policy, approval, cost, and fallback proof. |
| Tool Gateway | Focused docs route check reports `tool-gateway route consistency ok`; implementation proof remains gated until a touched `knowgrph` owner exposes tool catalog, provider select, web/image/TTS/browser route, schema, approval, egress, cost, and fallback proof. |
| Tool Search | Focused docs route check reports `tool-search route consistency ok`; implementation proof remains gated until a touched `knowgrph` owner exposes opt-in activation, deferred catalog search, schema describe, bridge call, real-tool policy, and cost proof. |
| Computing-flow | `npm -C "$KNOWGRPH_ROOT/canvas" run test:ci:unit -- chat.responseContract.prompt.kgcComputingFlowKtvShape` exits 0 and `/computing-flow` remains projection-only. |
| Learning loop | Focused docs route check reports `learning-loop route consistency ok`; implementation proof remains gated until a touched `knowgrph` owner exposes typed memory, experience, skill, and identity outputs. |
| Stateful orchestration | Focused docs route check reports `orchestration route consistency ok`; implementation proof remains gated until a touched `knowgrph` owner exposes typed graph, checkpoint, review, and trace outputs. |
| Long-horizon SuperAgent | Focused docs route check reports `superagent route consistency ok`; implementation proof remains gated until a touched `knowgrph` owner exposes typed graph, sandbox workspace, message gateway, artifact manifest, verification, cost, and stop condition outputs. |

## Deploy Guard

Documentation-only changes must end with:

```bash
git -C "$AGENTIC_CANVAS_OS_ROOT" status --short -- docs
git -C "$KNOWGRPH_ROOT" status --short
```

Confirm:

- No Prod mirror mutation under `$PROD_MIRROR_ROOT`.
- No Cloudflare deploy command was run.
- Any Cloudflare or Prod deploy remains `gated` until explicit operator authorization.

## Runtime-Ready Promotion Rule

Promote from `spec-complete` to `runtime-ready` only when the final response includes:

- File or owner changed.
- Commands run.
- Exit codes or concise result lines.
- Any skipped validation and why.
- Deploy boundary statement.

## Failure Handling

| Failure | Response |
|---|---|
| Frontmatter parse fails | Fix the authored YAML source; do not rely on parser repair. |
| Artifact scan finds copied local media token | Remove the copied value and replace with a neutral placeholder or source-owned reference. |
| Runtime test fails in unrelated dirty owner | Report the failure and isolate whether touched files caused it; do not revert user changes. |
| Deploy command needed for proof | Stop and ask for explicit authorization. |
