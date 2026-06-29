<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Ship workflow (default)

After feature work is done and tested:

1. **Merge** the PR into `main` (`gh pr merge <number> --merge`).
2. **Deploy production** — `npx vercel deploy --prod --yes` (project: `viperclaw/rapidmot`).
3. Confirm the production alias: https://rapidmot-seven.vercel.app

Do not leave merged-but-undeployed changes on `main` unless the user explicitly asks to hold deployment.

