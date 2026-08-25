# Data Preservation Policy

## 목표
코드 업데이트 때문에 기존 회의록/폴더가 사라지는 것을 방지한다.

## 운영 규칙
1. 운영 Render에서는 `REQUIRE_PERSISTENT_DB=true`.
2. `DATABASE_URL`이 없으면 앱은 시작하지 않는다.
   - 이전처럼 빈 SQLite DB로 조용히 전환하지 않는다.
3. Render Blueprint의 DB 이름은 계속 `meeting-minutes-db`로 유지한다.
4. 데이터베이스를 삭제하거나 새 DB 이름으로 바꾸는 작업은 일반 코드 업데이트에 포함하지 않는다.
5. DB migration은 `ADD COLUMN` / `CREATE TABLE IF NOT EXISTS` 같은 additive migration만 사용한다.
6. 기존 meetings/folders/users 행을 migration에서 DELETE/TRUNCATE/DROP하지 않는다.

## 20분 자동저장
- 새 회의 작성 중: PostgreSQL `drafts` 테이블에 사용자별 초안 저장.
- 기존 회의 수정 중: 실제 meetings row에 20분마다 저장.
- 브라우저 localStorage 임시저장도 기존처럼 유지.

## 주의
Render Free PostgreSQL 자체가 만료/삭제되면 코드만으로 복구할 수 없다.
운영 전에는 장기 보존 DB와 정기 백업이 별도로 필요하다.
