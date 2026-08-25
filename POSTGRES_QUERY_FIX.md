# PostgreSQL meeting-list query fix

Symptom:
`회의록 목록을 불러오지 못했습니다: 요청에 실패했습니다.`

Changes:
- Removed `DISTINCT` from the meeting list query.
- Translation search now uses `EXISTS` instead of joining translation rows.
- PostgreSQL-safe ordering.
- Frontend errors now show HTTP status, API path, and server detail.
- Added admin DB diagnostics endpoint: `/api/admin/diagnostics/db`.
