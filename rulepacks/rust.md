Review lens for Rust. Judge against THIS repo's existing patterns first.

Material things worth a comment:
- Real correctness bugs: panics on attacker/user input (unwrap/expect/indexing) in non-test code, integer overflow assumptions, incorrect Option/Result handling that swallows errors.
- Concurrency/ownership hazards: data races behind unsafe, holding a lock across .await, blocking calls in async, Send/Sync violations.
- unsafe blocks: any new unsafe must be justified; flag missing safety invariants.
- API/contract breaks: changed public fn signatures, trait impls, or error types that callers depend on.

Do NOT comment on (unless the repo clearly cares):
- Formatting, import grouping — rustfmt owns these.
- Lints clippy already reports. Never repeat them.

Tooling that may have settled facts: cargo check, clippy, rustfmt. Never repeat their findings.
