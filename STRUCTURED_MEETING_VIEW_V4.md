# Structured Meeting View V4

상세 회의록 화면을 아래 4개 섹션으로 표준화.

1. 회의개요
   - 회의명
   - 일시
   - 회의장소
   - 회의방식
   - 참석자
   - 작성자
   - 회의목적

2. 요약

3. 회의 세부사항
   - 기존 `transcript` 필드를 그대로 사용하여 과거 데이터 보존

4. F/U 사항

## 데이터 보존
기존 meetings 테이블을 삭제/교체하지 않고 컬럼만 추가:
- location
- meeting_method
- purpose
- follow_up

기존 participants / author / title / recorded_at / summary / transcript는 그대로 사용.

20분 자동저장용 drafts에도 동일 필드를 additive migration으로 추가.
기존 회의록은 새 필드가 NULL인 상태로 그대로 표시되며 `-`로 렌더링됨.
