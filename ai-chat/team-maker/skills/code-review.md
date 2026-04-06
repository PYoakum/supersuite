# Code Review

## Review Checklist
1. **Correctness** — Does the code do what it claims? Edge cases handled?
2. **Security** — No injection vulnerabilities (SQL, XSS, command). Secrets not hardcoded. Input validated at boundaries.
3. **Error handling** — Failures handled gracefully. No swallowed errors. User-facing errors are helpful.
4. **Naming** — Variables, functions, types clearly named. No ambiguous abbreviations.
5. **Simplicity** — No premature abstraction. No dead code. No unnecessary indirection.
6. **Performance** — No N+1 queries. No unbounded allocations. Pagination where needed.

## What NOT to Flag
- Style preferences that don't affect correctness
- Missing comments on self-explanatory code
- Unused imports (let the linter handle it)
- Test coverage percentages

## Feedback Format
- Lead with what's good
- Be specific: cite the file and line, explain the issue, suggest a fix
- Distinguish blocking issues from suggestions
- "This will break when X" > "Consider handling X"
