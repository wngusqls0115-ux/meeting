from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT/"app.py").read_text(encoding="utf-8")
JS = (ROOT/"static/app.js").read_text(encoding="utf-8")
HTML = (ROOT/"static/index.html").read_text(encoding="utf-8")
RENDER = (ROOT/"render.yaml").read_text(encoding="utf-8")
CONTRACT = (ROOT/"LOCKED_DEVELOPMENT_CONTRACT_V10.md").read_text(encoding="utf-8")

folder_pos = HTML.find('class="folder-section"')
meeting_pos = HTML.find('class="folder-meeting-section"')
calendar_pos = HTML.find('class="calendar-section"')

checks = {
    "persistent_db": "meeting-minutes-db" in RENDER,
    "persistent_guard": "REQUIRE_PERSISTENT_DB" in RENDER,
    "no_drop_table": re.search(r"(?i)\bDROP\s+TABLE\b", APP) is None,
    "no_truncate": re.search(r"(?i)\bTRUNCATE\s+TABLE\b", APP) is None,
    "password_freeform_backend": (
        "if password is None or len(password) == 0:" in APP
        and "len(password) < 12" not in APP
        and "password.lower() == password" not in APP
    ),
    "password_no_minlength_ui": (
        'id="newPassword"' in HTML
        and 'id="adminPassword"' in HTML
        and 'minlength="12"' not in HTML
    ),
    "password_freeform_notice": "비밀번호 형식 제한은 없습니다." in HTML,

    "meeting_add_label": "+ 회의 추가" in HTML,
    "meeting_overview": 'id="overviewTitle"' in HTML and 'id="overviewPurpose"' in HTML,
    "meeting_summary": 'id="summary"' in HTML,
    "meeting_detail": 'id="transcript"' in HTML,
    "meeting_followup": 'id="followUp"' in HTML,
    "folder_parent": "parent_id" in APP,
    "folder_palette": "FOLDER_COLORS" in JS,
    "folder_context": 'id="folderContextMenu"' in HTML,
    "folder_expand_toggle": "expandedMeetingFolderId" in JS,
    "folder_move_handle": 'className = "folder-move-handle"' in JS and 'moveHandle.textContent = "=";' in JS,
    "folder_name_not_handle": "setupFolderMoveHandle(btn, row, f)" not in JS,
    "meeting_move": '/api/meetings/${meetingId}/folder' in JS,
    "meeting_server_verified": "result.verified" in JS,
    "meeting_second_readback": 'verifiedMeeting = await api(`/api/meetings/${meetingId}?lang=ko`)' in JS,
    "fu_calendar": 'id="calendarGrid"' in HTML,
    "fu_calendar_detail": (
        'id="openCalendarDetail"' in HTML
        and 'id="calendarDetail"' in HTML
        and "showCalendarDetail" in JS
        and "renderCalendarDetail" in JS
        and 'id="calendarDetailGrid"' in HTML
    ),
    "fu_search": 'id="fuSearch"' in HTML and "/api/follow-ups/search" in APP,
    "fu_memo": 'id="fuMemoDialog"' in HTML and '/api/follow-ups/{follow_up_id}/memo' in APP,
    "fu_color": 'class="fu-color"' in JS,
    "fu_completion": "completed_date" in APP and "completion_note" in APP,
    "sidebar_toggle": 'id="sidebarToggle"' in HTML and "SIDEBAR_COLLAPSED_KEY" in JS,
    "sidebar_order": folder_pos >= 0 and folder_pos < meeting_pos < calendar_pos,
    "autosave_20min": "AUTO_SAVE_INTERVAL_MS = 20 * 60 * 1000" in JS,
    "translation_en": 'data-lang="en"' in HTML,
    "translation_ja": 'data-lang="ja"' in HTML,
    "contract_locked": "Status: LOCKED_BASELINE" in CONTRACT,
}

failed = []
for name, ok in checks.items():
    print(f"{'PASS' if ok else 'FAIL'}  {name}")
    if not ok:
        failed.append(name)

if failed:
    print("\nREGRESSION LOCK FAILED:", ", ".join(failed))
    sys.exit(1)

print("\nREGRESSION LOCK: PASS")
