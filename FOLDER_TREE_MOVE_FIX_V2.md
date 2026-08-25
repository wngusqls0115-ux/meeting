# Folder Tree / Move Fix V2

- `populateFolderParentSelect()` stale reference completely removed.
- Folder rename uses dedicated `/rename` endpoint and modal dialog.
- ▾ / ▸ collapses and expands child folders.
- Collapsed state persists in browser localStorage.
- ⇄ opens a move dialog for changing parent folder.
- ⋮⋮ drag handle moves a folder under another folder.
- A root drop zone appears while dragging; dropping there moves the folder to top level.
- Backend cycle validation prevents moving a folder inside itself or its descendants.
- Folder color uses dedicated `/color` endpoint.
- Database schema unchanged; existing meeting/folder data remains in the same database.
