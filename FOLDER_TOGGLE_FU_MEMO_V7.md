# V7 — Folder Toggle + F/U Memo

## Folder / meeting movement
- Meetings remain draggable to folders.
- User folders remain draggable with the left mouse.
- Dropping a folder on another folder makes it a child.
- Root drop zone moves it back to top level.
- A drag flag suppresses accidental folder clicks immediately after moving.

## Folder click behavior
- Click folder name once: show meetings directly underneath.
- Click the same folder name again: hide those meetings.
- Switching folders closes the previous inline meeting list and opens the selected folder.
- Inline meeting rows show meeting title only.
- Inline meetings remain draggable.

## F/U memo
- `follow_up_items.memo` additive DB column.
- Clicking an item in "이번 달 F/U" opens a memo dialog.
- Memo can be saved independently without editing the meeting.
- "연관 회의로 이동" opens the source meeting.
- The memo is included in F/U model/readback so later meeting edits preserve it.

## Data preservation
- No DROP/TRUNCATE.
- Existing meetings/folders untouched.
- Only `follow_up_items.memo` is added.
