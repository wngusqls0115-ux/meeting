# Paste-only meeting input + folder rename v1

## Meeting input
- PLAUD transcript file upload UI removed.
- No TXT/SRT/MD import path in the browser.
- Users always copy meeting content from PLAUD and paste it into the meeting-content textarea.
- Optional PLAUD summary can also be pasted manually.

## Folder rename
- Every user-created folder now has an edit button (`✎`).
- Clicking `✎` prompts for a new folder name.
- Double-clicking a folder row also opens rename.
- Rename preserves:
  - parent folder
  - folder color
  - meetings in the folder
  - child folders
- If the currently opened meeting belongs to the renamed folder, its displayed folder name updates immediately.
