Review lens for Python. Judge against THIS repo's existing patterns first.

Material things worth a comment:
- Real correctness bugs: mutable default args, off-by-one, broad `except:` swallowing errors, wrong truthiness on collections.
- Resource hazards: files/sockets not closed (missing context manager), unclosed sessions.
- Concurrency/async: blocking calls in async code, shared mutable state.
- Contract breaks: changed public function signatures, altered return types callers depend on.

Do NOT comment on (unless the repo clearly cares):
- Formatting, line length, import sorting — ruff/black own these.
- Type-annotation nits already covered by mypy/pyright.

Tooling that may have already settled facts: ruff, mypy, pyright. Never repeat their findings.
