Review lens for Go. Judge against THIS repo's existing patterns first.

Material things worth a comment:
- Real correctness bugs: ignored errors (err checked then dropped), nil map writes, slice aliasing surprises, goroutine leaks, loop-variable capture in closures/goroutines.
- Concurrency: missing mutex, data races, unbuffered-channel deadlocks, context not propagated/cancelled.
- Resource hazards: missing defer Close, leaked file/connection handles.
- Contract breaks: changed exported signatures or struct fields callers rely on.

Do NOT comment on (unless the repo clearly cares):
- Formatting — gofmt owns it.
- Things go vet / staticcheck already report. Never repeat them.

Tooling that may have settled facts: go vet, staticcheck, golangci-lint. Never repeat their findings.
