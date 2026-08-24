# 회의록 앱 MVP v5 — 로그인/권한 완성 버전

## 접근 정책

- 웹 주소 자체는 누구나 열 수 있습니다.
- 회의록 목록/본문/검색/번역/공유/API 데이터는 로그인하지 않으면 서버가 `401`로 차단합니다.
- 공개 회원가입은 없습니다.
- 최초 관리자 계정은 서버 환경변수로 1회 생성합니다.
- 관리자는 앱의 **사용자 관리** 화면에서 허용 사용자만 추가할 수 있습니다.
- 모든 활성 로그인 사용자는 회의록 조회/등록/수정/번역/보호 링크 생성을 사용할 수 있습니다.
- 비활성화된 사용자는 즉시 접근할 수 없고, 기존 세션도 제거됩니다.
- 비밀번호 변경/관리자 초기화 시 기존 세션을 폐기합니다.

## 현재 기능

- PLAUD → Zapier webhook 수신
- PLAUD TXT/SRT/Markdown 수동 가져오기
- 회의록 저장/검색/수정
- 한국어/영어/일본어 번역 및 번역 캐시
- 로그인 보호 공유 링크
- 공유 링크 만료 설정
- 관리자 사용자 추가/활성화/비활성화/비밀번호 초기화
- 사용자 본인 비밀번호 변경
- HttpOnly 세션 쿠키
- SQLite 저장

## 로컬 실행

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt

$env:APP_ADMIN_EMAIL="admin@company.com"
$env:APP_ADMIN_PASSWORD="StrongPassword123"
$env:APP_ADMIN_NAME="관리자"

$env:PLAUD_WEBHOOK_SECRET="replace-with-a-long-random-secret"
$env:OPENAI_API_KEY="YOUR_OPENAI_API_KEY"
$env:OPENAI_TRANSLATION_MODEL="gpt-5.6-luna"

$env:COOKIE_SECURE="false"
$env:COOKIE_SAMESITE="lax"
$env:FRONTEND_ORIGINS="http://localhost:8000"

uvicorn app:app --host 0.0.0.0 --port 8000
```

브라우저:
`http://localhost:8000`

## 실제 인터넷 배포 시 필수

실제 `https://...` 주소로 서비스할 때는 최소한 아래를 적용하세요.

```text
COOKIE_SECURE=true
COOKIE_SAMESITE=lax
FRONTEND_ORIGINS=https://실제-회의록-도메인
```

프런트와 API를 같은 도메인에서 제공하는 구성을 권장합니다.

## 최초 관리자 계정 주의

DB에 사용자가 한 명도 없을 때만 `APP_ADMIN_EMAIL` / `APP_ADMIN_PASSWORD`로 최초 관리자를 생성합니다.
운영 환경에서는 충분히 강한 비밀번호를 사용하고, 최초 로그인 후 앱에서 비밀번호를 변경하세요.

## 사용자 추가

1. 관리자 로그인
2. 왼쪽 계정 영역의 `사용자 관리`
3. 이름 / 이메일 / 초기 비밀번호 입력
4. 사용자 추가
5. 해당 사용자에게 URL과 로그인 계정을 별도로 전달

공개 회원가입 URL은 제공하지 않습니다.

## 보호 공유 링크

회의록의 `공유` 버튼으로 만든 URL은 누구에게나 전달할 수 있습니다.
그러나 링크를 연 브라우저에 유효한 로그인 세션이 없으면 로그인 화면으로 이동하며,
로그인 성공 후 원래 공유 링크로 돌아옵니다.

즉 **링크 보유 = 열람 권한**이 아닙니다.

## 아직 별도 결정이 필요한 것

이 ZIP은 실행 가능한 앱 코드입니다. 실제 인터넷에서 누구나 접속할 수 있는 고정 URL은
서버/클라우드/사내 인프라 중 한 곳에 배포해야 생성됩니다. 특정 호스팅 서비스는 강제하지 않습니다.
