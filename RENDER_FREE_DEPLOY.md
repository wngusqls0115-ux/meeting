# Render Free 테스트 배포

이 버전은 카드 등록 없이 공개 URL 동작을 검증하기 위한 테스트용입니다.

## 중요
Render Free Web Service의 로컬 파일은 영구 저장소가 아닙니다.
따라서 SQLite `meetings.db`의 회의록/사용자 데이터가 재배포·재시작 시 사라질 수 있습니다.

운영 전에는 아래 중 하나로 전환해야 합니다.
- 유료 Persistent Disk
- PostgreSQL
- 회사 서버/클라우드 DB

## 배포 순서

1. 이 버전을 GitHub `main`에 push
2. Render Dashboard → New + → Blueprint
3. `wngusqls0115-ux/meeting` 선택
4. Blueprint가 `render.yaml`을 읽음
5. 다음 Secret 입력
   - APP_ADMIN_EMAIL
   - APP_ADMIN_PASSWORD
   - PLAUD_WEBHOOK_SECRET
   - OPENAI_API_KEY
6. Apply / Deploy
7. 생성된 `https://...onrender.com` 주소 접속
8. 관리자 계정으로 로그인
9. 회의 생성/수정/공유/번역 테스트

## 최초 관리자 비밀번호 조건
12자 이상 + 영문 대문자 + 영문 소문자 + 숫자 포함

예:
StrongPassword1234

## 테스트 합격 후
PostgreSQL 영구 DB 연결 → 커스텀 도메인 연결 순서로 진행합니다.
