# Testing & QA

## Test Strategy
- **Unit tests**: Pure functions, parsers, validators. Fast, no I/O.
- **Integration tests**: API endpoints with real database. Test the contract, not internals.
- **No mocks** for databases — use a real test instance. Mock/prod divergence causes silent failures.

## What to Test
- Happy path: does the normal case work?
- Boundary cases: empty input, max length, zero, negative
- Error paths: invalid input returns correct error, not 500
- Auth: unauthenticated requests rejected, wrong role rejected

## What NOT to Test
- Framework behavior (don't test that Express routes work)
- Trivial getters/setters
- Implementation details that change with refactoring

## Test Structure
```
describe("feature", () => {
  it("does the expected thing", () => { ... });
  it("rejects invalid input with 400", () => { ... });
  it("requires authentication", () => { ... });
});
```

## Naming
- Test names describe behavior: "returns 404 when task not found"
- Not implementation: "calls findTask and checks null"
