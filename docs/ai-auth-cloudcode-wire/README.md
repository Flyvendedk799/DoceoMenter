# ai-auth companion patch (Cloud Code wire)

Cloud agent could not push to `Flyvendedk799/ai-auth` (no write token). Apply this into ai-auth:

```bash
cd ai-auth
git checkout -b cursor/antigravity-cloudcode-wire-93d7
git apply path/to/ai-auth-cloudcode-wire.patch
# bump already included → 0.9.1
pnpm test
git push -u origin HEAD
gh pr create --title "fix: match real agy Cloud Code wire" --body "See DoceoMenter #29"
```

See also https://github.com/Flyvendedk799/ai-auth/issues/5
