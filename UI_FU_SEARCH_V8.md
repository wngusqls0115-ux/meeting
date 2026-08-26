# V8 Changes

1. 회의 추가
- 좌측 버튼 `+ 회의 내용 붙여넣기` -> `+ 회의 추가`
- 빈 화면 버튼 `첫 회의 가져오기` -> `첫 회의 추가`
- dialog 제목 `회의 가져오기` -> `회의 추가`
- 실제 회의 내용 입력 방식은 PLAUD 복사/붙여넣기 유지

2. 저장소 표시 제거
- 좌측 `저장소 확인 중... / DB: PostgreSQL ...` UI 제거
- 사용자 로그인/권한 보호는 유지
- 영구 DB 보호(`REQUIRE_PERSISTENT_DB`)도 유지

3. 폴더 이동
- HTML5 drag&drop 의존을 제거하고 Pointer Events 방식으로 재작성
- 폴더명에서 왼쪽 마우스 버튼을 누른 채 6px 이상 움직이면 이동 시작
- 다른 폴더 위에 놓으면 하위 폴더로 이동
- 최상위 drop zone에 놓으면 root로 이동
- 단순 클릭은 기존처럼 회의록 펼침/접힘

4. F/U 검색
- 업무내용 / 담당자 / 메모 / 완료사항 / 연관 회의명 검색
- 검색은 모든 F/U를 대상으로 수행
- 검색어 삭제 시 이번 달 F/U 목록으로 복귀

5. F/U 색상
- 폴더와 동일한 muted 10-color palette 사용
- 상세 F/U 카드 / 캘린더 날짜 점 / 이번 달 F/U 목록에 적용

6. 좌측 안내창 접기/펼치기
- 좌측 상단 경계의 ‹ / › 버튼
- 접힘 상태 localStorage 기억

Data:
- existing meetings/folders preserved
- only follow_up_items.color additive column
