---
title: "Knowgrph Agentic Canvas OS Validation Runbook"
graphId: "md:knowgrph-agentic-canvas-os-validation-runbook"
doc_type: "Validation Runbook"
date: "2026-07-07"
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
export AGENTIC_CANVAS_OS_ROOT GITHUB_ROOT DOCS_ROOT KNOWGRPH_ROOT PROD_MIRROR_ROOT MEMORY_ROOT
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

## Todo Log Compliance Checks

At session start, verify the isolated worktree ledger and freeze its exact fetched baseline:

```bash
export TODO_LOG_PATH="$WORKTREE/todo-log.md"
export TODO_BASE_REF="<recorded-knowgrph-origin-main-sha>"
ruby -rdate -ryaml -ropen3 -e 'path=ENV.fetch("TODO_LOG_PATH"); base=ENV.fetch("TODO_BASE_REF"); root=File.dirname(path); source=File.read(path); match=source.match(/\A---\n(.*?)\n---\n/m) or abort("todo-log: missing frontmatter"); data=YAML.safe_load(match[1], permitted_classes:[Date], aliases:true); required={"title"=>"todo-log","doc_type"=>"Planning Ledger","status"=>"active","frontmatter_contract"=>"required"}; required.each{|key,value| abort("todo-log: invalid #{key}") unless data[key]==value}; abort("todo-log: missing one-row directive contract") unless source.include?("one-row-one-directive (Max 50 words)"); header="| Context | Intent | Directive | Module | Class/Object | Function/Method | Input | Output | Decision Logic | Next Step Recommendation | Updated Date |"; separator="|--------|--------|-----------|--------|-----------------|-------|--------|----------------|--------------------------|--------------------------|--------------|"; abort("todo-log: table header mismatch") unless source.lines.count{|line| line.chomp==header}>0 && source.lines.count{|line| line.chomp==header}==source.lines.count{|line| line.chomp==separator}; source.scan(/^## ([0-9]{4}-[0-9]{2}-[0-9]{2})$/).flatten.each{|date| Date.iso8601(date)}; prior,status=Open3.capture2("git","-C",root,"show","#{base}:todo-log.md"); abort("todo-log: cannot read base ref") unless status.success?; abort("todo-log: startup baseline differs from fetched base") unless source==prior; puts "todo-log startup baseline ok"'
```

Before release, require the task's declared Context row to be new or changed relative to that baseline:

```bash
export TODO_CONTEXT="<exact-task-row-context>"
ruby -rdate -ryaml -ropen3 -e 'path=ENV.fetch("TODO_LOG_PATH"); base=ENV.fetch("TODO_BASE_REF"); context=ENV.fetch("TODO_CONTEXT"); abort("todo-log: empty or unsafe context") if context.empty? || context.include?("|"); root=File.dirname(path); current=File.read(path); prior,status=Open3.capture2("git","-C",root,"show","#{base}:todo-log.md"); abort("todo-log: cannot read base ref") unless status.success?; validate_contract=->(source){match=source.match(/\A---\n(.*?)\n---\n/m) or abort("todo-log: missing frontmatter"); data=YAML.safe_load(match[1], permitted_classes:[Date], aliases:true); {"title"=>"todo-log","doc_type"=>"Planning Ledger","status"=>"active","frontmatter_contract"=>"required"}.each{|key,value| abort("todo-log: invalid #{key}") unless data[key]==value}; abort("todo-log: missing one-row directive contract") unless source.include?("one-row-one-directive (Max 50 words)"); header="| Context | Intent | Directive | Module | Class/Object | Function/Method | Input | Output | Decision Logic | Next Step Recommendation | Updated Date |"; separator="|--------|--------|-----------|--------|-----------------|-------|--------|----------------|--------------------------|--------------------------|--------------|"; abort("todo-log: table header mismatch") unless source.lines.count{|line| line.chomp==header}>0 && source.lines.count{|line| line.chomp==header}==source.lines.count{|line| line.chomp==separator}; source.scan(/^## ([0-9]{4}-[0-9]{2}-[0-9]{2})$/).flatten.each{|date| Date.iso8601(date)}}; validate_contract.call(current); parse=->(text){section=nil; rows=[]; text.each_line do |line|; if match=line.match(/^## ([0-9]{4}-[0-9]{2}-[0-9]{2})$/); section=match[1]; next; end; next unless line.start_with?("| "); cells=line.strip.split("|",-1)[1...-1].map(&:strip); next if cells.first=="Context"; rows << {line:line,cells:cells,section:section}; end; rows}; current_rows=parse.call(current); base_rows=parse.call(prior); matches=current_rows.select{|row| row[:cells].first==context}; abort("todo-log: task context must occur exactly once") unless matches.length==1; row=matches.first; abort("todo-log: task row must have 11 cells") unless row[:cells].length==11; abort("todo-log: task row has empty cells") if row[:cells].any?(&:empty?); directive_words=row[:cells][2].split(/\s+/).length; abort("todo-log: directive exceeds 50 words") if directive_words>50; updated=row[:cells][10]; Date.iso8601(updated); abort("todo-log: Updated Date must match dated section") unless row[:section]==updated; abort("todo-log: Module must name todo-log.md") unless row[:cells][3].include?("todo-log.md"); prior_row=base_rows.find{|candidate| candidate[:cells].first==context}; abort("todo-log: declared task row was not updated") if prior_row && prior_row[:line]==row[:line]; changed_history=base_rows.reject{|candidate| candidate[:cells].first==context}.reject{|candidate| current_rows.any?{|current_row| current_row[:line]==candidate[:line]}}; abort("todo-log: historical rows changed or deleted: #{changed_history.map{|candidate| candidate[:cells].first}.join(", ")}") unless changed_history.empty?; puts "todo-log task row ok: context=#{context} directive_words=#{directive_words}"'
```

Expected:

- Startup proves `todo-log.md` is the exact fetched planning-ledger baseline before task mutation.
- The task declaration records one stable `todo_context`; release finds it exactly once.
- The task row has the canonical 11 columns, no empty cells, a directive of at most 50 words, a valid `Updated Date` matching its dated section, and a Module cell naming `todo-log.md`.
- A row unchanged from the base fails; changing or deleting any non-target historical row fails.
- Historical baseline rows remain byte-for-byte unchanged. Strict row validation applies to the task's new or changed row.

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

| Capability | Focused check |
|---|---|
| Capability discovery | Tool catalog test exits 0 and reports deduplicated tool ids. |
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
