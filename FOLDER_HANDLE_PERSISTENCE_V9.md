# V9 — Folder "=" Handle + Meeting Location Persistence

## Folder movement UI
- folder name is NOT a drag target
- far-left `=` button is the only folder movement handle
- folder name click remains meeting-list open/close only
- no floating text ghost is created
- destination row is highlighted while dragging
- root drop zone remains available

## Meeting folder persistence
`PATCH /api/meetings/{id}/folder` now:
1. validates meeting and destination folder
2. UPDATEs `meetings.folder_id`
3. COMMITs
4. SELECTs the same row back from DB
5. compares stored folder_id with requested folder_id
6. returns `verified: true` only after successful readback

Frontend then performs a second independent:
`GET /api/meetings/{id}?lang=ko`

The UI reports "저장 완료" only if this GET also returns the requested folder_id.
On any mismatch the UI reloads the server truth instead of retaining a false moved position.

## Data
- no schema change
- no DROP/TRUNCATE
- existing meetings/folders/F/U preserved
