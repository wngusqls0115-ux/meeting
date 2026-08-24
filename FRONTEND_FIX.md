# Frontend fix 20260824-frontend-fix-1

Symptoms addressed:
- Main page renders but user name remains placeholder `사용자`
- `+ 회의 가져오기` does nothing
- JavaScript may be stale or not loading after Render deploy

Changes:
- Disable browser caching for HTML/JS/CSS
- Add version query to JS/CSS assets
- Add visible error banner for JavaScript load/runtime errors
- Keep existing auth/meeting functionality unchanged
