# Static site fixture

A single-file HTML page used by DoceoMenter's integration tests as a stand-in for "a project that has a static frontend."

## Why this exists

DoceoMenter's capture engine boots whatever the project ships. We need a tiny, deterministic site that exercises the static boot strategy.

## Layout

- `index.html` — the entire site.
- `package.json` — present so the fixture is recognized as a workspace project.
