# Render Free 테스트 배포 — OpenAI API 없이

이 버전은 카드 등록 및 OpenAI API Key 없이 공개 URL/로그인/회의록 기능을 테스트합니다.

## 사용할 Secret
Render에서 아래 3개만 입력합니다.

- APP_ADMIN_EMAIL
- APP_ADMIN_PASSWORD
- PLAUD_WEBHOOK_SECRET

`OPENAI_API_KEY`는 입력하지 않습니다.

## 동작하는 기능
- 공개 URL 접속
- 로그인 보호
- 회의록 등록
- 회의록 조회
- 회의록 수정
- 검색
- 보호 공유 링크
- 관리자 사용자 관리
- PLAUD webhook 수신 구조

## 이번 테스트에서 비활성화되는 기능
- 영어 자동 번역
- 일본어 자동 번역

앱 화면의 English / 日本語 버튼은 API Key가 없으면 비활성화됩니다.

## PLAUD_WEBHOOK_SECRET
직접 만든 긴 임의 문자열을 사용합니다.
예:
LSMeeting_PLAUD_2026_X7m92Kq4Vb81Nz3P

## 주의
Render Free의 SQLite 파일은 영구 저장이 보장되지 않습니다.
이번 단계는 기능 확인용입니다.
