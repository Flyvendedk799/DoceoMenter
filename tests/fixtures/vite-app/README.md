# Vite app fixture

A minimal Vite + TypeScript app DoceoMenter uses to verify the `vite` boot strategy:

1. `pnpm install` (cold).
2. `pnpm dev` → vite dev server on `127.0.0.1:5173`.
3. Capture engine polls the URL until it responds, then takes screenshots.

Pure presentation; no router, no state, no API calls. Lives in this repo so the integration test is hermetic — no network dependency for the source.
