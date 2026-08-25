from fastapi import FastAPI, HTTPException, Header, Query, Request, Response, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional
from pathlib import Path
from datetime import datetime, timezone, timedelta
import sqlite3
import secrets
import os
import json
import urllib.request
import urllib.error
import hashlib
import hmac

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:
    psycopg = None
    dict_row = None

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("DB_PATH", str(BASE_DIR / "meetings.db")))
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
USE_POSTGRES = bool(DATABASE_URL)
WEBHOOK_SECRET = os.getenv("PLAUD_WEBHOOK_SECRET", "change-me")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_TRANSLATION_MODEL = os.getenv("OPENAI_TRANSLATION_MODEL", "gpt-5.6-luna")
FRONTEND_ORIGINS = [x.strip() for x in os.getenv("FRONTEND_ORIGINS", "http://localhost:8000").split(",") if x.strip()]
APP_ADMIN_EMAIL = os.getenv("APP_ADMIN_EMAIL", "").strip().lower()
APP_ADMIN_PASSWORD = os.getenv("APP_ADMIN_PASSWORD", "")
APP_ADMIN_NAME = os.getenv("APP_ADMIN_NAME", "관리자")
SESSION_DAYS = int(os.getenv("SESSION_DAYS", "7"))
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").strip().lower() in {"1", "true", "yes", "on"}
COOKIE_SAMESITE = os.getenv("COOKIE_SAMESITE", "lax").strip().lower()
if COOKIE_SAMESITE not in {"lax", "strict", "none"}:
    COOKIE_SAMESITE = "lax"
SESSION_COOKIE = "mm_session"

app = FastAPI(title="Meeting Minutes MVP")
app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def disable_frontend_cache(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path.lower()
    if path == "/" or path.endswith((".html", ".js", ".css")):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

LANGUAGES = {
    "ko": "Korean",
    "en": "English",
    "ja": "Japanese",
}


class PgCursorProxy:
    def __init__(self, cursor, lastrowid=None):
        self._cursor = cursor
        self.lastrowid = lastrowid

    @property
    def rowcount(self):
        return self._cursor.rowcount

    def fetchone(self):
        return self._cursor.fetchone()

    def fetchall(self):
        return self._cursor.fetchall()


class PgConnectionProxy:
    def __init__(self, conn):
        self._conn = conn

    def _convert_sql(self, sql: str) -> str:
        # The app uses SQLite-style qmark parameters. PostgreSQL/psycopg uses %s.
        return sql.replace("?", "%s")

    def execute(self, sql, params=()):
        converted = self._convert_sql(sql)
        stripped = converted.lstrip().upper()
        returning_id = False

        # These inserts are the only places where current app code reads .lastrowid.
        for table in ("MEETINGS", "USERS", "FOLDERS"):
            if stripped.startswith(f"INSERT INTO {table}") and "RETURNING " not in stripped:
                converted = converted.rstrip().rstrip(";") + " RETURNING id"
                returning_id = True
                break

        cur = self._conn.cursor()
        cur.execute(converted, tuple(params) if params is not None else ())
        lastrowid = None
        if returning_id:
            returned = cur.fetchone()
            if returned:
                lastrowid = returned["id"]
        return PgCursorProxy(cur, lastrowid=lastrowid)

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()


def db():
    if USE_POSTGRES:
        if psycopg is None:
            raise RuntimeError("DATABASE_URL is set but psycopg is not installed")
        conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
        return PgConnectionProxy(conn)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


DB_INTEGRITY_ERRORS = (sqlite3.IntegrityError,)
if psycopg is not None:
    DB_INTEGRITY_ERRORS = DB_INTEGRITY_ERRORS + (psycopg.IntegrityError,)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def hash_password(password: str, salt: bytes | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310000)
    return salt.hex(), digest.hex()


def verify_password(password: str, salt_hex: str, expected_hex: str) -> bool:
    try:
        salt = bytes.fromhex(salt_hex)
    except ValueError:
        return False
    _, actual_hex = hash_password(password, salt)
    return hmac.compare_digest(actual_hex, expected_hex)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def init_db():
    conn = db()

    if USE_POSTGRES:
        statements = [
            """
            CREATE TABLE IF NOT EXISTS users (
                id BIGSERIAL PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                display_name TEXT,
                password_salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                is_admin INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id BIGINT NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS folders (
                id BIGSERIAL PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS meetings (
                id BIGSERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                recorded_at TEXT,
                transcript TEXT NOT NULL,
                summary TEXT,
                participants TEXT,
                source TEXT NOT NULL DEFAULT 'manual',
                created_at TEXT NOT NULL,
                updated_at TEXT,
                folder_id BIGINT,
                FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE SET NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS shares (
                token TEXT PRIMARY KEY,
                meeting_id BIGINT NOT NULL,
                expires_at TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(meeting_id) REFERENCES meetings(id)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS translations (
                id BIGSERIAL PRIMARY KEY,
                meeting_id BIGINT NOT NULL,
                language TEXT NOT NULL,
                translated_title TEXT NOT NULL,
                translated_summary TEXT,
                translated_transcript TEXT NOT NULL,
                model TEXT,
                created_at TEXT NOT NULL,
                UNIQUE(meeting_id, language),
                FOREIGN KEY(meeting_id) REFERENCES meetings(id)
            )
            """,
            "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS updated_at TEXT",
            "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS folder_id BIGINT",
        ]
        for statement in statements:
            conn.execute(statement)
        conn.commit()
    else:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                display_name TEXT,
                password_salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                is_admin INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS meetings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                recorded_at TEXT,
                transcript TEXT NOT NULL,
                summary TEXT,
                participants TEXT,
                source TEXT NOT NULL DEFAULT 'manual',
                created_at TEXT NOT NULL,
                updated_at TEXT,
                folder_id INTEGER,
                FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS shares (
                token TEXT PRIMARY KEY,
                meeting_id INTEGER NOT NULL,
                expires_at TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(meeting_id) REFERENCES meetings(id)
            );

            CREATE TABLE IF NOT EXISTS translations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_id INTEGER NOT NULL,
                language TEXT NOT NULL,
                translated_title TEXT NOT NULL,
                translated_summary TEXT,
                translated_transcript TEXT NOT NULL,
                model TEXT,
                created_at TEXT NOT NULL,
                UNIQUE(meeting_id, language),
                FOREIGN KEY(meeting_id) REFERENCES meetings(id)
            );
            """
        )
        columns = {r[1] for r in conn.execute("PRAGMA table_info(meetings)").fetchall()}
        if "updated_at" not in columns:
            conn.execute("ALTER TABLE meetings ADD COLUMN updated_at TEXT")
        if "folder_id" not in columns:
            conn.execute("ALTER TABLE meetings ADD COLUMN folder_id INTEGER")
        conn.commit()

    user_count = conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
    if user_count == 0 and APP_ADMIN_EMAIL and APP_ADMIN_PASSWORD:
        salt_hex, password_hex = hash_password(APP_ADMIN_PASSWORD)
        conn.execute(
            """
            INSERT INTO users(email, display_name, password_salt, password_hash, is_active, is_admin, created_at)
            VALUES (?, ?, ?, ?, 1, 1, ?)
            """,
            (APP_ADMIN_EMAIL, APP_ADMIN_NAME, salt_hex, password_hex, now_iso()),
        )
        conn.commit()

    conn.close()


init_db()


class LoginIn(BaseModel):
    email: str
    password: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


class AdminUserCreateIn(BaseModel):
    email: str
    display_name: Optional[str] = None
    password: str


class AdminUserPatchIn(BaseModel):
    display_name: Optional[str] = None
    is_active: Optional[bool] = None
    new_password: Optional[str] = None


class FolderIn(BaseModel):
    name: str


class MeetingFolderMoveIn(BaseModel):
    folder_id: Optional[int] = None


class MeetingIn(BaseModel):
    title: str = Field(default="제목 없는 회의")
    recorded_at: Optional[str] = None
    transcript: str
    summary: Optional[str] = None
    participants: Optional[list[str] | str] = None
    source: str = "manual"
    folder_id: Optional[int] = None


class MeetingUpdate(BaseModel):
    title: str
    recorded_at: Optional[str] = None
    transcript: str
    summary: Optional[str] = None
    participants: Optional[list[str] | str] = None
    folder_id: Optional[int] = None


class ShareIn(BaseModel):
    expires_hours: Optional[int] = Field(default=168, ge=1, le=24 * 365)


class TranslationIn(BaseModel):
    target_language: str = Field(pattern="^(en|ja)$")
    force_refresh: bool = False


def normalize_participants(value):
    if value is None:
        return None
    if isinstance(value, list):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def parse_participants(value):
    if not value:
        return value
    try:
        return json.loads(value)
    except Exception:
        return value


def row_to_meeting(row):
    if not row:
        return None
    d = dict(row)
    d["participants"] = parse_participants(d.get("participants"))
    return d


def row_to_translation(row):
    if not row:
        return None
    d = dict(row)
    return {
        "meeting_id": d["meeting_id"],
        "language": d["language"],
        "title": d["translated_title"],
        "summary": d.get("translated_summary"),
        "transcript": d["translated_transcript"],
        "model": d.get("model"),
        "created_at": d["created_at"],
    }


def public_user(row):
    return {
        "id": row["id"],
        "email": row["email"],
        "display_name": row["display_name"],
        "is_admin": bool(row["is_admin"]),
        "is_active": bool(row["is_active"]),
    }


def validate_new_password(password: str):
    if len(password) < 12:
        raise HTTPException(status_code=400, detail="비밀번호는 12자 이상이어야 합니다.")
    if password.lower() == password or password.upper() == password:
        raise HTTPException(status_code=400, detail="비밀번호에는 영문 대문자와 소문자를 모두 포함해 주세요.")
    if not any(ch.isdigit() for ch in password):
        raise HTTPException(status_code=400, detail="비밀번호에는 숫자를 1개 이상 포함해 주세요.")
    return True


def get_current_user_optional(request: Request):
    raw_token = request.cookies.get(SESSION_COOKIE)
    if not raw_token:
        return None
    token_hash = hash_session_token(raw_token)
    conn = db()
    row = conn.execute(
        """
        SELECT u.*, s.expires_at AS session_expires_at
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash=? AND u.is_active=1
        """,
        (token_hash,),
    ).fetchone()
    if not row:
        conn.close()
        return None
    if datetime.fromisoformat(row["session_expires_at"]) < datetime.now(timezone.utc):
        conn.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash,))
        conn.commit()
        conn.close()
        return None
    result = public_user(row)
    conn.close()
    return result


def require_user(request: Request):
    user = get_current_user_optional(request)
    if not user:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
    return user


def require_admin(user=Depends(require_user)):
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다.")
    return user


def create_meeting(payload: MeetingIn):
    now = now_iso()
    conn = db()
    cur = conn.execute(
        """
        INSERT INTO meetings(title, recorded_at, transcript, summary, participants, source, created_at, updated_at, folder_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload.title.strip() or "제목 없는 회의",
            payload.recorded_at,
            payload.transcript,
            payload.summary,
            normalize_participants(payload.participants),
            payload.source,
            now,
            now,
            payload.folder_id,
        ),
    )
    conn.commit()
    meeting_id = cur.lastrowid
    row = conn.execute("SELECT * FROM meetings WHERE id=?", (meeting_id,)).fetchone()
    conn.close()
    return row_to_meeting(row)


def get_original_meeting(meeting_id: int):
    conn = db()
    row = conn.execute(
        """
        SELECT m.*, f.name AS folder_name
        FROM meetings m
        LEFT JOIN folders f ON f.id = m.folder_id
        WHERE m.id=?
        """,
        (meeting_id,),
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return row_to_meeting(row)


def get_translation(meeting_id: int, language: str):
    conn = db()
    row = conn.execute(
        "SELECT * FROM translations WHERE meeting_id=? AND language=?",
        (meeting_id, language),
    ).fetchone()
    conn.close()
    return row_to_translation(row)


def available_translation_languages(meeting_id: int):
    conn = db()
    rows = conn.execute(
        "SELECT language FROM translations WHERE meeting_id=? ORDER BY language",
        (meeting_id,),
    ).fetchall()
    conn.close()
    return [r["language"] for r in rows]


def extract_output_text(api_response: dict) -> str:
    if isinstance(api_response.get("output_text"), str):
        return api_response["output_text"]
    texts = []
    for item in api_response.get("output", []):
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                texts.append(content["text"])
    return "\n".join(texts).strip()


def parse_json_text(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            return json.loads(cleaned[start : end + 1])
        raise


def call_translation_model(meeting: dict, target_language: str):
    if not OPENAI_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY가 설정되지 않았습니다. 서버 환경변수에 API 키를 설정해 주세요.",
        )

    target_name = LANGUAGES[target_language]
    source_payload = {
        "title": meeting.get("title") or "",
        "summary": meeting.get("summary") or "",
        "transcript": meeting.get("transcript") or "",
    }

    instructions = f"""
You are a professional meeting-minutes translator for manufacturing, engineering, R&D, and business meetings.
Translate the supplied Korean meeting content into {target_name}.

Rules:
- Preserve all technical terms, numbers, units, chemical formulas, equipment names, proper nouns, dates, and action items accurately.
- Preserve speaker labels, timestamps, bullets, section structure, and line breaks as much as possible.
- Do not summarize, omit, embellish, or add explanations.
- If a proper noun or acronym should remain unchanged, keep it unchanged.
- For Japanese, use natural professional business/technical Japanese.
- For English, use concise professional technical English.
- Return ONLY a valid JSON object with exactly these keys: title, summary, transcript.
- Every value must be a JSON string. If summary is empty, return an empty string.
""".strip()

    body = {
        "model": OPENAI_TRANSLATION_MODEL,
        "input": [
            {"role": "system", "content": instructions},
            {
                "role": "user",
                "content": "Translate this meeting JSON:\n" + json.dumps(source_payload, ensure_ascii=False),
            },
        ],
    }

    req = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=502, detail=f"Translation API error: {detail[:1000]}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Translation request failed: {exc}")

    text = extract_output_text(payload)
    if not text:
        raise HTTPException(status_code=502, detail="Translation API returned no text output")

    try:
        translated = parse_json_text(text)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Translation output parsing failed: {exc}")

    for key in ("title", "summary", "transcript"):
        if key not in translated or not isinstance(translated[key], str):
            raise HTTPException(status_code=502, detail=f"Translation output missing valid '{key}' field")
    return translated


@app.get("/api/health")
def health():
    conn = db()
    user_count = conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
    conn.close()
    return {
        "ok": True,
        "auth_configured": user_count > 0,
        "translation_configured": bool(OPENAI_API_KEY),
        "translation_model": OPENAI_TRANSLATION_MODEL,
        "cookie_secure": COOKIE_SECURE,
        "cookie_samesite": COOKIE_SAMESITE,
        "storage_backend": "postgresql" if USE_POSTGRES else "sqlite_ephemeral",
        "persistent_storage": bool(USE_POSTGRES),
    }


@app.post("/api/auth/login")
def login(payload: LoginIn, response: Response):
    email = payload.email.strip().lower()
    conn = db()
    row = conn.execute("SELECT * FROM users WHERE email=? AND is_active=1", (email,)).fetchone()
    if not row or not verify_password(payload.password, row["password_salt"], row["password_hash"]):
        conn.close()
        raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다.")
    raw_token = secrets.token_urlsafe(32)
    token_hash = hash_session_token(raw_token)
    expires = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    conn.execute(
        "INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
        (token_hash, row["id"], expires.isoformat(), now_iso()),
    )
    conn.commit()
    user = public_user(row)
    conn.close()
    response.set_cookie(
        key=SESSION_COOKIE, value=raw_token, httponly=True, secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE, max_age=SESSION_DAYS * 24 * 3600, path="/"
    )
    return {"user": user}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    raw_token = request.cookies.get(SESSION_COOKIE)
    if raw_token:
        conn = db()
        conn.execute("DELETE FROM sessions WHERE token_hash=?", (hash_session_token(raw_token),))
        conn.commit()
        conn.close()
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@app.get("/api/auth/me")
def me(user=Depends(require_user)):
    return {"user": user}


@app.post("/api/auth/change-password")
def change_password(payload: ChangePasswordIn, user=Depends(require_user)):
    validate_new_password(payload.new_password)
    conn = db()
    row = conn.execute("SELECT * FROM users WHERE id=? AND is_active=1", (user["id"],)).fetchone()
    if not row or not verify_password(payload.current_password, row["password_salt"], row["password_hash"]):
        conn.close()
        raise HTTPException(status_code=400, detail="현재 비밀번호가 올바르지 않습니다.")
    salt_hex, password_hex = hash_password(payload.new_password)
    conn.execute(
        "UPDATE users SET password_salt=?, password_hash=? WHERE id=?",
        (salt_hex, password_hex, user["id"]),
    )
    # Invalidate all other sessions after a password change.
    conn.execute("DELETE FROM sessions WHERE user_id=?", (user["id"],))
    conn.commit()
    conn.close()
    return {"ok": True, "relogin_required": True}


@app.get("/api/admin/users")
def admin_list_users(admin=Depends(require_admin)):
    conn = db()
    rows = conn.execute(
        "SELECT id, email, display_name, is_active, is_admin, created_at FROM users ORDER BY created_at, id"
    ).fetchall()
    conn.close()
    return [
        {
            "id": r["id"],
            "email": r["email"],
            "display_name": r["display_name"],
            "is_active": bool(r["is_active"]),
            "is_admin": bool(r["is_admin"]),
            "created_at": r["created_at"],
        }
        for r in rows
    ]


@app.post("/api/admin/users")
def admin_create_user(payload: AdminUserCreateIn, admin=Depends(require_admin)):
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="올바른 이메일 주소를 입력해 주세요.")
    validate_new_password(payload.password)
    salt_hex, password_hex = hash_password(payload.password)
    conn = db()
    try:
        cur = conn.execute(
            """
            INSERT INTO users(email, display_name, password_salt, password_hash, is_active, is_admin, created_at)
            VALUES (?, ?, ?, ?, 1, 0, ?)
            """,
            (email, (payload.display_name or "").strip() or None, salt_hex, password_hex, now_iso()),
        )
        conn.commit()
    except DB_INTEGRITY_ERRORS:
        conn.close()
        raise HTTPException(status_code=409, detail="이미 등록된 이메일입니다.")
    row = conn.execute("SELECT * FROM users WHERE id=?", (cur.lastrowid,)).fetchone()
    result = public_user(row)
    conn.close()
    return result


@app.patch("/api/admin/users/{user_id}")
def admin_update_user(user_id: int, payload: AdminUserPatchIn, admin=Depends(require_admin)):
    conn = db()
    row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    if user_id == admin["id"] and payload.is_active is False:
        conn.close()
        raise HTTPException(status_code=400, detail="현재 로그인한 관리자 계정은 비활성화할 수 없습니다.")

    updates = []
    values = []
    if payload.display_name is not None:
        updates.append("display_name=?")
        values.append(payload.display_name.strip() or None)
    if payload.is_active is not None:
        updates.append("is_active=?")
        values.append(1 if payload.is_active else 0)
    if payload.new_password:
        validate_new_password(payload.new_password)
        salt_hex, password_hex = hash_password(payload.new_password)
        updates.extend(["password_salt=?", "password_hash=?"])
        values.extend([salt_hex, password_hex])

    if updates:
        values.append(user_id)
        conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id=?", values)
        if payload.is_active is False or payload.new_password:
            conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        conn.commit()

    updated = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    result = public_user(updated)
    conn.close()
    return result


@app.post("/api/plaud/webhook")
def plaud_webhook(payload: MeetingIn, x_webhook_secret: Optional[str] = Header(default=None)):
    if WEBHOOK_SECRET != "change-me" and x_webhook_secret != WEBHOOK_SECRET:
        raise HTTPException(status_code=401, detail="Invalid webhook secret")
    payload.source = "plaud-zapier"
    return create_meeting(payload)


@app.get("/api/folders")
def list_folders(user=Depends(require_user)):
    conn = db()
    rows = conn.execute(
        """
        SELECT f.id, f.name, f.created_at, COUNT(m.id) AS meeting_count
        FROM folders f
        LEFT JOIN meetings m ON m.folder_id = f.id
        GROUP BY f.id, f.name, f.created_at
        ORDER BY LOWER(f.name), f.id
        """
    ).fetchall()
    total_count = conn.execute("SELECT COUNT(*) AS n FROM meetings").fetchone()["n"]
    uncategorized_count = conn.execute(
        "SELECT COUNT(*) AS n FROM meetings WHERE folder_id IS NULL"
    ).fetchone()["n"]
    conn.close()
    return {
        "folders": [
            {
                "id": r["id"],
                "name": r["name"],
                "created_at": r["created_at"],
                "meeting_count": r["meeting_count"],
            }
            for r in rows
        ],
        "total_count": total_count,
        "uncategorized_count": uncategorized_count,
    }


@app.post("/api/folders")
def create_folder(payload: FolderIn, user=Depends(require_user)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="폴더 이름을 입력해 주세요.")
    if len(name) > 80:
        raise HTTPException(status_code=400, detail="폴더 이름은 80자 이하로 입력해 주세요.")

    conn = db()
    try:
        cur = conn.execute(
            "INSERT INTO folders(name, created_at) VALUES (?, ?)",
            (name, now_iso()),
        )
        conn.commit()
    except DB_INTEGRITY_ERRORS:
        conn.close()
        raise HTTPException(status_code=409, detail="같은 이름의 폴더가 이미 있습니다.")

    row = conn.execute("SELECT * FROM folders WHERE id=?", (cur.lastrowid,)).fetchone()
    result = dict(row)
    conn.close()
    return result


@app.patch("/api/folders/{folder_id}")
def rename_folder(folder_id: int, payload: FolderIn, user=Depends(require_user)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="폴더 이름을 입력해 주세요.")

    conn = db()
    try:
        cur = conn.execute("UPDATE folders SET name=? WHERE id=?", (name, folder_id))
        if cur.rowcount == 0:
            conn.close()
            raise HTTPException(status_code=404, detail="폴더를 찾을 수 없습니다.")
        conn.commit()
    except DB_INTEGRITY_ERRORS:
        conn.close()
        raise HTTPException(status_code=409, detail="같은 이름의 폴더가 이미 있습니다.")

    row = conn.execute("SELECT * FROM folders WHERE id=?", (folder_id,)).fetchone()
    result = dict(row)
    conn.close()
    return result


@app.delete("/api/folders/{folder_id}")
def delete_folder(folder_id: int, user=Depends(require_user)):
    conn = db()
    row = conn.execute("SELECT id, name FROM folders WHERE id=?", (folder_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="폴더를 찾을 수 없습니다.")

    count_row = conn.execute(
        "SELECT COUNT(*) AS n FROM meetings WHERE folder_id=?",
        (folder_id,),
    ).fetchone()
    moved_count = count_row["n"] if count_row else 0

    conn.execute("UPDATE meetings SET folder_id=NULL WHERE folder_id=?", (folder_id,))
    conn.execute("DELETE FROM folders WHERE id=?", (folder_id,))
    conn.commit()
    conn.close()
    return {
        "ok": True,
        "deleted_folder_id": folder_id,
        "deleted_folder_name": row["name"],
        "moved_to_uncategorized": moved_count,
    }


@app.post("/api/meetings")
def add_meeting(payload: MeetingIn, user=Depends(require_user)):
    return create_meeting(payload)


@app.get("/api/meetings")
def list_meetings(q: str = "", folder: str = "all", user=Depends(require_user)):
    conn = db()
    clauses = []
    params = []

    if q.strip():
        like = f"%{q.strip()}%"
        clauses.append(
            """
            (
                m.title LIKE ? OR m.transcript LIKE ? OR COALESCE(m.summary,'') LIKE ?
                OR COALESCE(t.translated_title,'') LIKE ?
                OR COALESCE(t.translated_transcript,'') LIKE ?
                OR COALESCE(t.translated_summary,'') LIKE ?
            )
            """
        )
        params.extend([like, like, like, like, like, like])

    if folder == "uncategorized":
        clauses.append("m.folder_id IS NULL")
    elif folder not in {"", "all"}:
        try:
            folder_id = int(folder)
        except ValueError:
            conn.close()
            raise HTTPException(status_code=400, detail="잘못된 폴더 필터입니다.")
        clauses.append("m.folder_id=?")
        params.append(folder_id)

    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    rows = conn.execute(
        f"""
        SELECT DISTINCT
            m.id, m.title, m.recorded_at, m.summary, m.participants, m.source,
            m.created_at, m.folder_id, f.name AS folder_name
        FROM meetings m
        LEFT JOIN translations t ON t.meeting_id = m.id
        LEFT JOIN folders f ON f.id = m.folder_id
        {where}
        ORDER BY COALESCE(m.recorded_at, m.created_at) DESC
        """,
        params,
    ).fetchall()
    conn.close()

    result = []
    for r in rows:
        item = row_to_meeting(r)
        item["translations"] = available_translation_languages(item["id"])
        result.append(item)
    return result


@app.get("/api/meetings/{meeting_id}")
def get_meeting(meeting_id: int, lang: str = Query(default="ko", pattern="^(ko|en|ja)$"), user=Depends(require_user)):
    meeting = get_original_meeting(meeting_id)
    meeting["available_translations"] = available_translation_languages(meeting_id)
    meeting["language"] = "ko"

    if lang == "ko":
        return meeting

    translated = get_translation(meeting_id, lang)
    if not translated:
        raise HTTPException(status_code=404, detail="Requested translation has not been created yet")

    return {
        **meeting,
        "title": translated["title"],
        "summary": translated["summary"],
        "transcript": translated["transcript"],
        "language": lang,
        "translation_model": translated.get("model"),
        "translation_created_at": translated.get("created_at"),
    }


@app.patch("/api/meetings/{meeting_id}/folder")
def move_meeting_folder(meeting_id: int, payload: MeetingFolderMoveIn, user=Depends(require_user)):
    get_original_meeting(meeting_id)

    conn = db()
    folder_name = None
    if payload.folder_id is not None:
        folder = conn.execute(
            "SELECT id, name FROM folders WHERE id=?",
            (payload.folder_id,),
        ).fetchone()
        if not folder:
            conn.close()
            raise HTTPException(status_code=404, detail="이동할 폴더를 찾을 수 없습니다.")
        folder_name = folder["name"]

    conn.execute(
        "UPDATE meetings SET folder_id=?, updated_at=? WHERE id=?",
        (payload.folder_id, now_iso(), meeting_id),
    )
    conn.commit()
    conn.close()

    return {
        "ok": True,
        "meeting_id": meeting_id,
        "folder_id": payload.folder_id,
        "folder_name": folder_name,
    }


@app.put("/api/meetings/{meeting_id}")
def update_meeting(meeting_id: int, payload: MeetingUpdate, user=Depends(require_user)):
    get_original_meeting(meeting_id)
    conn = db()
    conn.execute(
        """
        UPDATE meetings
        SET title=?, recorded_at=?, transcript=?, summary=?, participants=?, updated_at=?, folder_id=?
        WHERE id=?
        """,
        (
            payload.title.strip() or "제목 없는 회의",
            payload.recorded_at,
            payload.transcript,
            payload.summary,
            normalize_participants(payload.participants),
            now_iso(),
            payload.folder_id,
            meeting_id,
        ),
    )
    conn.execute("DELETE FROM translations WHERE meeting_id=?", (meeting_id,))
    conn.commit()
    row = conn.execute(
        """
        SELECT m.*, f.name AS folder_name
        FROM meetings m
        LEFT JOIN folders f ON f.id = m.folder_id
        WHERE m.id=?
        """,
        (meeting_id,),
    ).fetchone()
    conn.close()
    result = row_to_meeting(row)
    result["available_translations"] = []
    result["language"] = "ko"
    return result


@app.post("/api/meetings/{meeting_id}/translate")
def translate_meeting(meeting_id: int, payload: TranslationIn, user=Depends(require_user)):
    existing = get_translation(meeting_id, payload.target_language)
    if existing and not payload.force_refresh:
        return {**existing, "cached": True}

    meeting = get_original_meeting(meeting_id)
    translated = call_translation_model(meeting, payload.target_language)
    now = datetime.now(timezone.utc).isoformat()

    conn = db()
    conn.execute(
        """
        INSERT INTO translations(
            meeting_id, language, translated_title, translated_summary,
            translated_transcript, model, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(meeting_id, language) DO UPDATE SET
            translated_title=excluded.translated_title,
            translated_summary=excluded.translated_summary,
            translated_transcript=excluded.translated_transcript,
            model=excluded.model,
            created_at=excluded.created_at
        """,
        (
            meeting_id,
            payload.target_language,
            translated["title"],
            translated["summary"],
            translated["transcript"],
            OPENAI_TRANSLATION_MODEL,
            now,
        ),
    )
    conn.commit()
    conn.close()

    return {
        "meeting_id": meeting_id,
        "language": payload.target_language,
        **translated,
        "model": OPENAI_TRANSLATION_MODEL,
        "created_at": now,
        "cached": False,
    }


@app.post("/api/meetings/{meeting_id}/share")
def create_share(meeting_id: int, payload: ShareIn, user=Depends(require_user)):
    get_original_meeting(meeting_id)
    token = secrets.token_urlsafe(24)
    now = datetime.now(timezone.utc)
    expires_at = (
        (now + timedelta(hours=payload.expires_hours)).isoformat()
        if payload.expires_hours
        else None
    )
    conn = db()
    conn.execute(
        """
        INSERT INTO shares(token, meeting_id, expires_at, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (token, meeting_id, expires_at, now.isoformat()),
    )
    conn.commit()
    conn.close()
    return {
        "token": token,
        "url": f"/share.html?token={token}",
        "expires_at": expires_at,
        "available_languages": ["ko"] + available_translation_languages(meeting_id),
        "login_required": True,
    }


def validate_share(token: str):
    conn = db()
    row = conn.execute(
        """
        SELECT s.meeting_id, s.expires_at
        FROM shares s
        WHERE s.token=?
        """,
        (token,),
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Share link not found")
    if row["expires_at"]:
        exp = datetime.fromisoformat(row["expires_at"])
        if exp < datetime.now(timezone.utc):
            raise HTTPException(status_code=410, detail="Share link expired")
    return dict(row)


@app.get("/api/share/{token}")
def read_share(token: str, lang: str = Query(default="ko", pattern="^(ko|en|ja)$"), user=Depends(require_user)):
    share = validate_share(token)
    meeting_id = share["meeting_id"]
    meeting = get_original_meeting(meeting_id)
    available = ["ko"] + available_translation_languages(meeting_id)
    result = {
        **meeting,
        "language": "ko",
        "available_languages": available,
        "expires_at": share["expires_at"],
    }

    if lang == "ko":
        return result

    translated = get_translation(meeting_id, lang)
    if not translated:
        raise HTTPException(status_code=404, detail="Requested translation is not available for this share link")

    return {
        **result,
        "title": translated["title"],
        "summary": translated["summary"],
        "transcript": translated["transcript"],
        "language": lang,
    }


app.mount("/", StaticFiles(directory=BASE_DIR / "static", html=True), name="static")
