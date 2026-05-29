# ast-grep Tool Reference

When using `ast-grep` tools (`openagent_ast_search`, `openagent_ast_replace`), use these
patterns to avoid hallucinated syntax.  The tool accepts **YAML rules** and **pattern strings**
compatible with the upstream [ast-grep CLI](https://ast-grep.github.io/).

---

## Pattern syntax quick reference

### Simple structural search (pattern string)

```yaml
rule:
  pattern: "console.log($MSG)"
```

### Multi-node matching with constraints

```yaml
rule:
  pattern: "const $VAR = $VAL"
  constraints:
    VAR:
      regex: "^[A-Z_]+$" # only match SCREAMING_SNAKE_CASE
```

### Replacement (openagent_ast_replace only)

```yaml
rule:
  pattern: "import { $IMPORTS } from '$SOURCE'"
fix: "import type { $IMPORTS } from '$SOURCE'"
```

### Multi-language selectors

| Language   | Selector key       |
|------------|--------------------|
| TypeScript | `language: tsx`   |
| JavaScript | `language: js`     |
| Python     | `language: python` |
| Go         | `language: go`     |
| Rust       | `language: rust`   |
| YAML       | `language: yaml`   |
| JSON       | `language: json`   |

---

## Common patterns for OpenAgent

### Find all `console.log` calls (TypeScript)

```yaml
rule:
  language: tsx
  pattern: "console.log($$$ARGS)"
```

### Rename a function across the codebase

```yaml
rule:
  language: tsx
  pattern: "oldFunctionName($$$ARGS)"
fix: "newFunctionName($$$ARGS)"
```

### Find bare `any` type annotations

```yaml
rule:
  language: tsx
  pattern: ": any"
```

### Find missing error handling (unwrapped promises)

```yaml
rule:
  language: tsx
  pattern: "await $FUNC($$$ARGS)"
  inside:
    pattern: "try { $$$BODY } catch"
    stopBy: end
```
*Note: this matches awaits NOT inside try/catch — use with `inside.negate` or invert via the tool.*

---

## Rules

- Always specify `language` when the file extension is ambiguous.
- Use `$$$NAME` for multi-node metavariables, `$NAME` for single-node.
- Prefer `fix` over `replace` for `openagent_ast_replace`.
- Constraints support `regex`, `kind`, `pattern`, and `has`.
- Test patterns with `ast-grep scan --rule rule.yaml` before dispatching.
