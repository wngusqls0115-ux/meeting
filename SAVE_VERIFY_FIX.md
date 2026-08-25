# Save verification fix

회의록 저장을 성공으로 표시하기 전에 다음 순서를 수행합니다.

1. POST `/api/meetings`
2. 서버가 `saved=true`와 새 meeting ID 반환
3. GET `/api/meetings/{id}` 로 DB에서 같은 row 즉시 재조회
4. 재조회 성공 시에만 `저장 확인 완료`
5. 목록 조회 실패는 저장 실패와 분리하여 표시

추가 안전장치:
- 회의 입력 내용은 브라우저 localStorage에 자동 임시저장
- 서버 저장/DB 재조회가 모두 성공한 뒤에만 임시저장 삭제
- 앱 좌측에서 현재 저장 backend를 표시
  - PostgreSQL = 지속 저장
  - SQLite = 임시 저장
