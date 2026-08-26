# F/U + Monthly Calendar V5

## F/U 구조
각 F/U는 별도 행으로 저장:
- 업무내용
- 담당자
- 시작일
- 종료일

DB:
`follow_up_items(id, meeting_id, task, owner, start_date, end_date, created_at, updated_at)`

기존 `meetings.follow_up` 텍스트 컬럼은 삭제하지 않음.
새 F/U를 저장할 때 구조화 항목의 텍스트 projection도 legacy follow_up에 유지함.

## 캘린더
좌측 폴더 아래 월별 캘린더 추가.
- 이전 달 / 오늘 / 다음 달
- F/U 기간에 포함되는 모든 날짜에 표시
- 최대 3개 색상 점 + 추가 개수 표시
- 월 전체 F/U 목록을 하단에서 동시에 확인
- 업무내용 / 담당자 / 기간 / 회의명 표시
- 클릭 시 원 회의록 열기

## 데이터 보존
- 기존 meetings/folders 삭제 없음
- follow_up_items 테이블만 CREATE TABLE IF NOT EXISTS
- drafts에는 follow_up_items_json 컬럼만 ADD COLUMN
- 기존 자유 텍스트 F/U는 그대로 보존
