window.MEETING_APP_LOADED = true;

window.addEventListener("error", (event) => {
  const banner = document.querySelector("#appErrorBanner");
  if (banner) {
    banner.textContent = "화면 스크립트 오류: " + (event.message || "알 수 없는 오류");
    banner.classList.remove("hidden");
  }
});

window.addEventListener("unhandledrejection", (event) => {
  const banner = document.querySelector("#appErrorBanner");
  if (banner) {
    const reason = event.reason?.message || String(event.reason || "알 수 없는 오류");
    banner.textContent = "앱 실행 오류: " + reason;
    banner.classList.remove("hidden");
  }
});

let currentMeetingId = null;
let currentLanguage = "ko";
let currentMeeting = null;
let debounceTimer = null;
let currentUser = null;
let translationConfigured = true;
let currentFolder = 'all';
let foldersCache = [];
let calendarCursor = new Date();
calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
let calendarItems = [];
let expandedMeetingFolderId = null;
let folderDragInProgress = false;
let fuMemoTarget = null;
let fuSearchTimer = null;
let folderPointerState = null;
let calendarDetailSelectedDate = null;
let folderCreateParentId = null;
let folderCreateColor = "#536878";
let folderColorTarget = null;
let folderRenameTarget = null;
let folderMoveTarget = null;
let folderContextTarget = null;

const COLLAPSED_FOLDERS_KEY = "meeting_collapsed_folders_v1";
let collapsedFolderIds = new Set();
try {
  collapsedFolderIds = new Set(JSON.parse(localStorage.getItem(COLLAPSED_FOLDERS_KEY) || "[]").map(String));
} catch {
  collapsedFolderIds = new Set();
}
function persistCollapsedFolders(){
  try { localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify([...collapsedFolderIds])); } catch {}
}
let editDirty = false;
let autoSaveBusy = false;

const AUTO_SAVE_INTERVAL_MS = 20 * 60 * 1000;
const FOLDER_COLORS = [
  {hex:"#536878", name:"슬레이트"},
  {hex:"#64748B", name:"블루그레이"},
  {hex:"#667761", name:"세이지"},
  {hex:"#7A6F66", name:"토프"},
  {hex:"#806A78", name:"모브"},
  {hex:"#73765A", name:"올리브"},
  {hex:"#756D91", name:"뮤트 퍼플"},
  {hex:"#8A6B57", name:"테라코타"},
  {hex:"#5F777A", name:"틸 그레이"},
  {hex:"#867A59", name:"오커"}
];

const FU_COLORS = FOLDER_COLORS;

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const API_BASE_URL = String(window.APP_CONFIG?.API_BASE_URL || "").replace(/\/$/, "");
const apiUrl = (path) => `${API_BASE_URL}${path}`;
const listEl = $("#meetingList");
const folderListEl = $("#folderList");
const detailEl = $("#detail");
const emptyEl = $("#empty");
const importDialog = $("#importDialog");
const editDialog = $("#editDialog");
const shareDialog = $("#shareDialog");
const IMPORT_DRAFT_KEY = "meeting_import_draft_v1";
let draftTimer = null;

function saveImportDraft(){
  const draft = {
    title: $("#importTitle")?.value || "",
    recorded_at: $("#importDate")?.value || "",
    folder_id: $("#importFolder")?.value || "",
    author: $("#importAuthor")?.value || "",
    location: $("#importLocation")?.value || "",
    meeting_method: $("#importMethod")?.value || "",
    participants: $("#importParticipants")?.value || "",
    purpose: $("#importPurpose")?.value || "",
    transcript: $("#importTranscript")?.value || "",
    summary: $("#importSummary")?.value || "",
    follow_up_items: collectFollowUpItems("importFollowUpItems"),
    saved_at: new Date().toISOString()
  };
  try {
    localStorage.setItem(IMPORT_DRAFT_KEY, JSON.stringify(draft));
    const el = $("#draftStatus");
    if(el && (draft.title || draft.transcript || draft.summary)){
      el.textContent = "브라우저에 임시저장됨";
      el.className = "draft-status";
    }
  } catch {}
}

function scheduleImportDraft(){
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveImportDraft, 350);
}

function restoreImportDraft(){
  try {
    const raw = localStorage.getItem(IMPORT_DRAFT_KEY);
    if(!raw) return false;
    const d = JSON.parse(raw);
    if(!(d.title || d.transcript || d.summary)) return false;

    $("#importTitle").value = d.title || "";
    $("#importDate").value = d.recorded_at || "";
    $("#importAuthor").value = d.author || currentUser?.display_name || currentUser?.email || "";
    $("#importLocation").value = d.location || "";
    $("#importMethod").value = d.meeting_method || "";
    $("#importParticipants").value = participantText(d.participants).replace("-", "");
    $("#importPurpose").value = d.purpose || "";
    $("#importTranscript").value = d.transcript || "";
    $("#importSummary").value = d.summary || "";
    setFollowUpEditor("importFollowUpItems", d.follow_up_items || [], "import");
    populateFolderSelects();
    if(d.folder_id && [...$("#importFolder").options].some(o => o.value === String(d.folder_id))){
      $("#importFolder").value = String(d.folder_id);
    }

    const el = $("#draftStatus");
    el.textContent = "이전에 저장되지 않은 입력 내용을 복구했습니다.";
    el.className = "draft-status restored";
    return true;
  } catch {
    return false;
  }
}

async function saveServerDraft(){
  const transcript = $("#importTranscript")?.value || "";
  const title = $("#importTitle")?.value || "";
  const summary = $("#importSummary")?.value || "";
  if(!(title.trim() || transcript.trim() || summary.trim())) return false;

  const data = await api("/api/drafts/current", {
    method:"PUT",
    body:JSON.stringify({
      title:title.trim() || null,
      recorded_at:$("#importDate")?.value || null,
      author:$("#importAuthor")?.value.trim() || null,
      folder_id:$("#importFolder")?.value ? Number($("#importFolder").value) : null,
      location:$("#importLocation")?.value.trim() || null,
      meeting_method:$("#importMethod")?.value.trim() || null,
      participants:$("#importParticipants")?.value.trim() || null,
      purpose:$("#importPurpose")?.value.trim() || null,
      transcript,
      summary:summary.trim() || null,
      follow_up_items:collectFollowUpItems("importFollowUpItems")
    })
  });
  return !!data.ok;
}

async function restoreServerDraft(){
  try {
    const data = await api("/api/drafts/current");
    const d = data?.draft;
    if(!d || !(d.title || d.transcript || d.summary)) return false;

    $("#importTitle").value = d.title || "";
    $("#importDate").value = d.recorded_at || "";
    $("#importAuthor").value = d.author || currentUser?.display_name || currentUser?.email || "";
    $("#importLocation").value = d.location || "";
    $("#importMethod").value = d.meeting_method || "";
    $("#importParticipants").value = participantText(d.participants).replace("-", "");
    $("#importPurpose").value = d.purpose || "";
    $("#importTranscript").value = d.transcript || "";
    $("#importSummary").value = d.summary || "";
    setFollowUpEditor("importFollowUpItems", d.follow_up_items || [], "import");
    populateFolderSelects();
    if(d.folder_id && [...$("#importFolder").options].some(o => o.value === String(d.folder_id))){
      $("#importFolder").value = String(d.folder_id);
    }
    const el = $("#draftStatus");
    el.textContent = `서버 자동저장 초안을 복구했습니다. (${new Date(d.updated_at).toLocaleString()})`;
    el.className = "draft-status restored";
    saveImportDraft();
    return true;
  } catch(err) {
    console.warn("Server draft restore failed:", err);
    return false;
  }
}

async function deleteServerDraft(){
  try { await api("/api/drafts/current", {method:"DELETE"}); } catch {}
}

async function autoSaveExistingEdit(){
  if(!$("#editDialog")?.open || !currentMeetingId || !editDirty) return false;

  const status = $("#editAutoSaveStatus");
  status.textContent = "자동저장 중...";
  try {
    const m = await api(`/api/meetings/${currentMeetingId}`, {
      method:"PUT",
      body:JSON.stringify({
        title:$("#editTitle").value.trim(),
        recorded_at:$("#editDate").value||null,
        location:$("#editLocation").value.trim()||null,
        meeting_method:$("#editMethod").value.trim()||null,
        participants:$("#editParticipants").value.trim()||null,
        author:$("#editAuthor").value.trim()||null,
        folder_id:$("#editFolder").value?Number($("#editFolder").value):null,
        purpose:$("#editPurpose").value.trim()||null,
        summary:$("#editSummary").value.trim()||null,
        transcript:$("#editTranscript").value,
        follow_up_items:collectFollowUpItems("editFollowUpItems")
      })
    });
    currentMeeting = m;
    editDirty = false;
    status.textContent = `자동저장 완료 · ${new Date().toLocaleTimeString()}`;
    await loadFolders();
    await loadMeetings($("#search").value);
    return true;
  } catch(err) {
    status.textContent = "자동저장 실패: " + err.message;
    return false;
  }
}

async function autoSaveTick(){
  if(autoSaveBusy) return;
  autoSaveBusy = true;
  try {
    if($("#importDialog")?.open){
      saveImportDraft();
      const ok = await saveServerDraft();
      if(ok){
        const el = $("#draftStatus");
        el.textContent = `서버 자동저장 완료 · ${new Date().toLocaleTimeString()}`;
        el.className = "draft-status";
      }
    }
    await autoSaveExistingEdit();
  } finally {
    autoSaveBusy = false;
  }
}

function clearImportDraft(){
  try { localStorage.removeItem(IMPORT_DRAFT_KEY); } catch {}
  const el = $("#draftStatus");
  if(el){
    el.textContent = "";
    el.classList.add("hidden");
  }
}


function loginUrl(){ return "/login.html?next=" + encodeURIComponent(location.pathname + location.search + location.hash); }

async function api(path, options={}) {
  let res;
  try {
    res = await fetch(apiUrl(path), {
      credentials:"include",
      headers:{"Content-Type":"application/json", ...(options.headers||{})},
      ...options
    });
  } catch(err) {
    throw new Error(`서버 연결 실패 (${path}): ${err.message}`);
  }

  if (res.status === 401) {
    location.replace(loginUrl());
    throw new Error("로그인이 필요합니다.");
  }

  if (!res.ok) {
    let detail = "";
    const contentType = res.headers.get("content-type") || "";
    try {
      if(contentType.includes("application/json")){
        const body = await res.json();
        detail = body.detail || JSON.stringify(body);
      } else {
        detail = (await res.text()).trim();
      }
    } catch {}

    const shortDetail = detail ? detail.slice(0, 300) : "서버 응답 본문 없음";
    throw new Error(`HTTP ${res.status} · ${path} · ${shortDetail}`);
  }

  return res.json();
}

async function requireLogin(){
  const r = await fetch(apiUrl("/api/auth/me"), {credentials:"include"});
  if (!r.ok) { location.replace(loginUrl()); return false; }
  const data = await r.json(); currentUser = data.user;
  $("#userName").textContent = currentUser.display_name || currentUser.email;
  $("#userEmail").textContent = currentUser.email;
  $("#adminBtn").classList.toggle("hidden", !currentUser.is_admin);
  return true;
}

function fmtDate(v){ if(!v) return ""; try { return new Date(v).toLocaleString("ko-KR"); } catch { return v; } }
function toLocalInput(v){ if(!v) return ""; const d=new Date(v); if(Number.isNaN(d.getTime())) return ""; const local=new Date(d.getTime()-d.getTimezoneOffset()*60000); return local.toISOString().slice(0,16); }
function escapeHtml(s){ return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }


const SIDEBAR_COLLAPSED_KEY = "meeting_sidebar_collapsed_v1";

function setSidebarCollapsed(collapsed){
  const appRoot = $("#appRoot");
  const sidebar = document.querySelector(".sidebar");
  const btn = $("#sidebarToggle");
  appRoot.classList.toggle("sidebar-collapsed", collapsed);
  sidebar.classList.toggle("collapsed", collapsed);
  btn.textContent = collapsed ? "›" : "‹";
  btn.title = collapsed ? "왼쪽 창 펼치기" : "왼쪽 창 접기";
  btn.setAttribute("aria-label", btn.title);
  try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0"); } catch {}
}

function restoreSidebarState(){
  let collapsed = false;
  try { collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"; } catch {}
  setSidebarCollapsed(collapsed);
}

function showToast(message, type="info"){
  let toast = document.querySelector("#appToast");
  if(!toast){
    toast = document.createElement("div");
    toast.id = "appToast";
    document.body.appendChild(toast);
  }
  toast.className = "app-toast " + type;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(window.__meetingToastTimer);
  window.__meetingToastTimer = setTimeout(()=>toast.classList.remove("show"), 2600);
}

async function loadFolders(){
  try {
    const data = await api("/api/folders");
    foldersCache = data.folders || [];
    renderFolders(data);
    populateFolderSelects();
    return true;
  } catch(err) {
    console.error("Folder load failed:", err);
    const error = $("#folderInlineError");
    if(error){
      error.textContent = "폴더를 불러오지 못했습니다. 회의록 기능은 계속 사용할 수 있습니다.";
      error.classList.remove("hidden");
    }
    return false;
  }
}

function folderDisplayLabel(value){
  if(value === "all") return "전체 회의";
  if(value === "uncategorized" || value === "" || value == null) return "미분류";
  const f = foldersCache.find(x => String(x.id) === String(value));
  return f ? f.name : "미분류";
}

function closeFolderContextMenu(){
  const menu = $("#folderContextMenu");
  if(menu) menu.classList.add("hidden");
  folderContextTarget = null;
}

function renderFolderContextPalette(folder){
  const container = $("#folderContextPalette");
  container.innerHTML = "";
  FOLDER_COLORS.forEach(item => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "folder-context-color" + (item.hex === (folder.color || "#536878") ? " selected" : "");
    btn.title = `${item.name} · ${item.hex}`;
    btn.setAttribute("aria-label", item.name);
    btn.innerHTML = `<span style="background:${item.hex}"></span><small>${escapeHtml(item.name)}</small>`;
    btn.onclick = async e => {
      e.stopPropagation();
      try {
        await updateFolderAppearance(folder, item.hex);
        closeFolderContextMenu();
      } catch {}
    };
    container.appendChild(btn);
  });
}

function openFolderContextMenu(folder, clientX, clientY){
  folderContextTarget = folder;
  const menu = $("#folderContextMenu");
  $("#folderContextTitle").textContent = folder.name;
  renderFolderContextPalette(folder);
  menu.classList.remove("hidden");
  menu.style.left = "0px";
  menu.style.top = "0px";
  const rect = menu.getBoundingClientRect();
  const pad = 8;
  const x = Math.max(pad, Math.min(clientX, window.innerWidth - rect.width - pad));
  const y = Math.max(pad, Math.min(clientY, window.innerHeight - rect.height - pad));
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
}

function clearFolderPointerHighlights(){
  $$(".user-folder-row.pointer-drop-target").forEach(el => el.classList.remove("pointer-drop-target"));
  $("#folderRootDropZone")?.classList.remove("drag-over");
}

function setupFolderMoveHandle(handle, row, folder){
  let drag = null;

  const resetVisuals = () => {
    row.classList.remove("folder-dragging");
    document.body.classList.remove("folder-drag-active");
    clearFolderPointerHighlights();
  };

  handle.addEventListener("pointerdown", e => {
    if(e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    drag = {
      pointerId:e.pointerId,
      startX:e.clientX,
      startY:e.clientY,
      active:false,
      targetFolderId:null,
      moveToRoot:false
    };
    try { handle.setPointerCapture(e.pointerId); } catch {}
  });

  handle.addEventListener("pointermove", e => {
    if(!drag || e.pointerId !== drag.pointerId) return;

    const distance = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if(!drag.active && distance >= 4){
      drag.active = true;
      folderDragInProgress = true;
      closeFolderContextMenu();
      row.classList.add("folder-dragging");
      document.body.classList.add("folder-drag-active");
    }

    if(!drag.active) return;
    e.preventDefault();

    clearFolderPointerHighlights();
    drag.targetFolderId = null;
    drag.moveToRoot = false;

    const rootZone = $("#folderRootDropZone");
    if(rootZone){
      const rect = rootZone.getBoundingClientRect();
      if(
        e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom
      ){
        rootZone.classList.add("drag-over");
        drag.moveToRoot = true;
        return;
      }
    }

    const element = document.elementFromPoint(e.clientX, e.clientY);
    const targetRow = element?.closest?.(".user-folder-row");
    if(!targetRow) return;

    const targetId = Number(targetRow.dataset.folderValue);
    if(targetId && targetId !== Number(folder.id)){
      targetRow.classList.add("pointer-drop-target");
      drag.targetFolderId = targetId;
    }
  });

  const finish = async (e, cancelled=false) => {
    if(!drag || e.pointerId !== drag.pointerId) return;
    const result = drag;
    drag = null;

    resetVisuals();
    try { handle.releasePointerCapture(e.pointerId); } catch {}

    if(!result.active) return;
    setTimeout(() => { folderDragInProgress = false; }, 120);
    if(cancelled) return;

    try {
      if(result.moveToRoot){
        await moveFolderToParent(folder.id, null);
      } else if(result.targetFolderId){
        await moveFolderToParent(folder.id, result.targetFolderId);
      } else {
        showToast("이동할 폴더 위에 = 버튼을 놓아 주세요.", "info");
      }
    } catch(err) {
      showToast("폴더 이동 실패: " + err.message, "error");
    }
  };

  handle.addEventListener("pointerup", e => finish(e, false));
  handle.addEventListener("pointercancel", e => finish(e, true));
}

function renderFolders(data){
  folderListEl.innerHTML = "";
  const folders = data.folders || [];
  const children = new Map();
  folders.forEach(f => {
    const key = f.parent_id == null ? "root" : String(f.parent_id);
    if(!children.has(key)) children.set(key, []);
    children.get(key).push(f);
  });

  function addSystemRow(label, value, count, icon){
    const row = document.createElement("div");
    row.className = "folder-row system-folder" + (String(currentFolder) === String(value) ? " active" : "");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "folder-filter-btn";
    btn.innerHTML = `<span class="folder-icon">${icon}</span><span class="folder-label">${escapeHtml(label)}</span><span class="folder-count">${Number(count || 0)}</span>`;
    btn.onclick = async () => {
      currentFolder = value;
      expandedMeetingFolderId = null;
      currentMeetingId = null;
      currentMeeting = null;
      detailEl.classList.add("hidden");
      renderFolders(data);
      await loadMeetings($("#search").value);
    };
    row.appendChild(btn);
    if(value === "uncategorized"){
      row.addEventListener("dragover", e => {
        if(e.dataTransfer.types.includes("text/meeting-id")){
          e.preventDefault();
          row.classList.add("drag-over");
        }
      });
      row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
      row.addEventListener("drop", async e => {
        e.preventDefault();
        row.classList.remove("drag-over");
        const meetingId = Number(e.dataTransfer.getData("text/meeting-id"));
        if(meetingId) await moveMeetingToFolder(meetingId, null, "미분류");
      });
    }
    folderListEl.appendChild(row);
  }

  function addFolderRow(f, depth){
    const row = document.createElement("div");
    row.className = "folder-row user-folder-row" + (String(currentFolder) === String(f.id) ? " active" : "");
    row.dataset.folderValue = String(f.id);
    row.draggable = false;
    row.title = "폴더명 클릭: 회의록 펼침/접힘 · = 버튼: 폴더 이동";

    row.addEventListener("dragover", e => {
      if(e.dataTransfer.types.includes("application/x-folder-id") || e.dataTransfer.types.includes("text/meeting-id")){
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        row.classList.add("drag-over");
      }
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", async e => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove("drag-over");
      document.body.classList.remove("folder-drag-active");
      const draggedFolderId = Number(e.dataTransfer.getData("application/x-folder-id"));
      if(draggedFolderId){
        if(draggedFolderId !== Number(f.id)){
          try { await moveFolderToParent(draggedFolderId, Number(f.id)); }
          catch(err){ showToast("폴더 이동 실패: " + err.message, "error"); }
        }
        return;
      }
      const meetingId = Number(e.dataTransfer.getData("text/meeting-id"));
      if(meetingId) await moveMeetingToFolder(meetingId, Number(f.id), f.name);
    });
    row.addEventListener("contextmenu", e => {
      e.preventDefault();
      e.stopPropagation();
      openFolderContextMenu(f, e.clientX, e.clientY);
    });

    const moveHandle = document.createElement("button");
    moveHandle.type = "button";
    moveHandle.className = "folder-move-handle";
    moveHandle.textContent = "=";
    moveHandle.title = `"${f.name}" 폴더 이동`;
    moveHandle.setAttribute("aria-label", `"${f.name}" 폴더 이동`);
    setupFolderMoveHandle(moveHandle, row, f);
    row.appendChild(moveHandle);

    const indent = document.createElement("span");
    indent.className = "folder-indent";
    indent.style.width = `${depth * 16}px`;
    row.appendChild(indent);

    const childRows = children.get(String(f.id)) || [];
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "folder-toggle-btn";
    if(childRows.length){
      const collapsed = collapsedFolderIds.has(String(f.id));
      toggle.textContent = collapsed ? "▸" : "▾";
      toggle.title = collapsed ? "하위 폴더 펼치기" : "하위 폴더 접기";
      toggle.onclick = e => {
        e.stopPropagation();
        const key = String(f.id);
        if(collapsedFolderIds.has(key)) collapsedFolderIds.delete(key); else collapsedFolderIds.add(key);
        persistCollapsedFolders();
        renderFolders(data);
      };
    } else {
      toggle.textContent = "·";
      toggle.disabled = true;
      toggle.classList.add("empty");
    }
    row.appendChild(toggle);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "folder-filter-btn tree-folder-btn";
    btn.draggable = false;
    btn.innerHTML = `<span class="folder-color-dot" style="background:${escapeHtml(f.color || "#536878")}"></span><span class="folder-label">${escapeHtml(f.name)}</span><span class="folder-count">${Number(f.meeting_count || 0)}</span>`;
    btn.onclick = async () => {
      if(folderDragInProgress) return;

      const folderId = String(f.id);
      const alreadyOpen = expandedMeetingFolderId === folderId;

      currentFolder = folderId;
      currentMeetingId = null;
      currentMeeting = null;
      detailEl.classList.add("hidden");

      if(alreadyOpen){
        expandedMeetingFolderId = null;
        renderFolders(data);
        listEl.innerHTML = "";
        listEl.classList.add("hidden");
        emptyEl.classList.add("hidden");
        return;
      }

      expandedMeetingFolderId = folderId;
      renderFolders(data);
      await loadMeetings($("#search").value);
    };
    btn.oncontextmenu = e => {
      e.preventDefault();
      e.stopPropagation();
      openFolderContextMenu(f, e.clientX, e.clientY);
    };
    row.appendChild(btn);

    const child = document.createElement("button");
    child.type = "button";
    child.className = "folder-child-btn";
    child.textContent = "+";
    child.title = `"${f.name}" 아래 하위 폴더 추가`;
    child.onclick = e => { e.stopPropagation(); openFolderCreateForParent(f.id); };
    row.appendChild(child);

    folderListEl.appendChild(row);
    if(expandedMeetingFolderId === String(f.id)){
      const inlineMeetings = document.createElement("div");
      inlineMeetings.className = "folder-inline-meetings";
      inlineMeetings.dataset.folderId = String(f.id);
      folderListEl.appendChild(inlineMeetings);
    }
    if(!collapsedFolderIds.has(String(f.id))) childRows.forEach(c => addFolderRow(c, depth + 1));
  }

  addSystemRow("전체 회의", "all", data.total_count, "▦");
  addSystemRow("미분류", "uncategorized", data.uncategorized_count, "○");
  (children.get("root") || []).forEach(f => addFolderRow(f, 0));
}

function folderDepth(folderId){
  let depth = 0;
  let current = foldersCache.find(f => String(f.id) === String(folderId));
  const seen = new Set();
  while(current && current.parent_id != null && !seen.has(String(current.id))){
    seen.add(String(current.id));
    depth += 1;
    current = foldersCache.find(f => String(f.id) === String(current.parent_id));
  }
  return depth;
}

function sortedFolderTree(){
  const children = new Map();
  foldersCache.forEach(f => {
    const key = f.parent_id == null ? "root" : String(f.parent_id);
    if(!children.has(key)) children.set(key, []);
    children.get(key).push(f);
  });
  const out = [];
  function walk(parentKey, depth){
    (children.get(parentKey) || []).forEach(f => {
      out.push({folder:f, depth});
      walk(String(f.id), depth + 1);
    });
  }
  walk("root", 0);
  return out;
}

function folderColorName(hex){
  return FOLDER_COLORS.find(c => c.hex === hex)?.name || hex || "색상";
}

function renderPalette(container, selectedHex, onSelect){
  container.innerHTML = "";
  FOLDER_COLORS.forEach(item => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "color-choice" + (item.hex === selectedHex ? " selected" : "");
    btn.title = `${item.name} · ${item.hex}`;
    btn.innerHTML = `
      <span class="color-choice-swatch" style="background:${item.hex}"></span>
      <span class="color-choice-name">${escapeHtml(item.name)}</span>
      <span class="color-choice-code">${item.hex}</span>`;
    btn.onclick = () => onSelect(item.hex);
    container.appendChild(btn);
  });
}

function openFolderCreateForParent(parentId=null){
  folderCreateParentId = parentId == null ? null : Number(parentId);
  const parent = foldersCache.find(f => Number(f.id) === Number(folderCreateParentId));
  folderCreateColor = parent?.color && FOLDER_COLORS.some(c => c.hex === parent.color)
    ? parent.color
    : "#536878";

  $("#folderCreateForm").reset();
  $("#folderCreateParentId").value = folderCreateParentId == null ? "" : String(folderCreateParentId);
  $("#folderCreateTitle").textContent = parent ? "하위 폴더 추가" : "새 폴더";
  $("#folderCreateParentText").textContent = parent
    ? `상위 폴더: ${parent.name}`
    : "최상위 폴더로 생성합니다.";
  $("#folderCreateError").classList.add("hidden");

  const selectCreateColor = (hex) => {
    folderCreateColor = hex;
    renderPalette($("#folderCreatePalette"), folderCreateColor, selectCreateColor);
    $("#folderCreateSelectedColor").textContent = `${folderColorName(hex)} · ${hex}`;
  };
  renderPalette($("#folderCreatePalette"), folderCreateColor, selectCreateColor);
  $("#folderCreateSelectedColor").textContent = `${folderColorName(folderCreateColor)} · ${folderCreateColor}`;

  $("#folderCreateDialog").showModal();
  setTimeout(() => $("#folderCreateName").focus(), 0);
}

function openFolderColorDialog(folder){
  folderColorTarget = folder;
  $("#folderColorName").textContent = folder.name;
  const currentHex = folder.color || "#536878";
  $("#folderColorCurrent").textContent = `현재 색상: ${folderColorName(currentHex)} · ${currentHex}`;
  renderPalette($("#folderColorPalette"), currentHex, async (hex) => {
    $("#folderColorCurrent").textContent = `선택 색상: ${folderColorName(hex)} · ${hex}`;
    await updateFolderAppearance(folder, hex);
    $("#folderColorDialog").close();
  });
  $("#folderColorDialog").showModal();
}


function openFolderRenameDialog(folder){
  folderRenameTarget = folder;
  $("#folderRenameId").value = String(folder.id);
  $("#folderRenameName").value = folder.name;
  $("#folderRenameError").classList.add("hidden");
  $("#folderRenameDialog").showModal();
  setTimeout(() => { $("#folderRenameName").focus(); $("#folderRenameName").select(); }, 0);
}

async function renameFolderInline(folder, newName){
  const cleanName = String(newName || "").trim();
  if(!cleanName) throw new Error("폴더명은 비워둘 수 없습니다.");

  const updated = await api(`/api/folders/${folder.id}/rename`, {
    method:"PATCH",
    body:JSON.stringify({name:cleanName})
  });

  if(currentMeeting && Number(currentMeeting.folder_id) === Number(folder.id)){
    currentMeeting.folder_name = updated.name;
    renderMeeting(currentMeeting);
  }

  await loadFolders();
  await loadMeetings($("#search").value);
  return updated;
}

function folderIsDescendant(candidateId, ancestorId){
  let current = foldersCache.find(f => Number(f.id) === Number(candidateId));
  const seen = new Set();
  while(current && current.parent_id != null){
    if(seen.has(String(current.id))) break;
    seen.add(String(current.id));
    if(Number(current.parent_id) === Number(ancestorId)) return true;
    current = foldersCache.find(f => Number(f.id) === Number(current.parent_id));
  }
  return false;
}

function populateFolderMoveParentSelect(folder){
  const sel = $("#folderMoveParent");
  sel.innerHTML = `<option value="">최상위 폴더</option>`;
  sortedFolderTree().forEach(({folder:candidate, depth}) => {
    if(Number(candidate.id) === Number(folder.id)) return;
    if(folderIsDescendant(candidate.id, folder.id)) return;
    const opt = document.createElement("option");
    opt.value = String(candidate.id);
    opt.textContent = `${"— ".repeat(depth)}${candidate.name}`;
    sel.appendChild(opt);
  });
  sel.value = folder.parent_id == null ? "" : String(folder.parent_id);
}

function openFolderMoveDialog(folder){
  folderMoveTarget = folder;
  $("#folderMoveId").value = String(folder.id);
  $("#folderMoveName").textContent = `이동할 폴더: ${folder.name}`;
  $("#folderMoveError").classList.add("hidden");
  populateFolderMoveParentSelect(folder);
  $("#folderMoveDialog").showModal();
}

async function moveFolderToParent(folderId, parentId){
  const updated = await api(`/api/folders/${folderId}/move`, {
    method:"PATCH",
    body:JSON.stringify({parent_id:parentId})
  });

  if(parentId != null){
    collapsedFolderIds.delete(String(parentId));
    persistCollapsedFolders();
  }
  await loadFolders();
  await loadMeetings($("#search").value);
  const parent = parentId == null ? null : foldersCache.find(f => Number(f.id) === Number(parentId));
  showToast(`폴더를 ${parent ? `"${parent.name}" 아래` : "최상위"}로 이동했습니다.`, "success");
  return updated;
}

async function updateFolderAppearance(folder, color){
  try {
    await api(`/api/folders/${folder.id}/color`, {
      method:"PATCH",
      body:JSON.stringify({color})
    });
    await loadFolders();
    if(currentMeeting && Number(currentMeeting.folder_id) === Number(folder.id)){
      currentMeeting.folder_color = color;
      renderMeeting(currentMeeting);
    }
    showToast(`"${folder.name}" 폴더 색상을 변경했습니다.`, "success");
  } catch(err) {
    showToast("폴더 색상 변경 실패: " + err.message, "error");
  }
}

function populateFolderSelects(){
  const tree = sortedFolderTree();
  ["#importFolder", "#editFolder", "#quickFolderSelect"].forEach(selector => {
    const sel = $(selector);
    if(!sel) return;
    const previous = sel.value;
    sel.innerHTML = `<option value="">미분류</option>`;
    tree.forEach(({folder, depth}) => {
      const opt = document.createElement("option");
      opt.value = String(folder.id);
      opt.textContent = `${"— ".repeat(depth)}${folder.name}`;
      sel.appendChild(opt);
    });
    if([...sel.options].some(o => o.value === previous)){
      sel.value = previous;
    }
  });

  if(currentMeeting && $("#quickFolderSelect")){
    $("#quickFolderSelect").value = currentMeeting.folder_id ? String(currentMeeting.folder_id) : "";
  }
}

async function createFolderInline(name){
  const cleanName = String(name || "").trim();
  if(!cleanName) return;

  const error = $("#folderCreateError");
  error.classList.add("hidden");
  try {
    const f = await api("/api/folders", {
      method:"POST",
      body:JSON.stringify({
        name:cleanName,
        parent_id:folderCreateParentId,
        color:folderCreateColor
      })
    });
    $("#folderCreateDialog").close();
    currentFolder = String(f.id);
    await loadFolders();
    await loadMeetings($("#search").value);
    showToast(`폴더 "${f.name}"를 만들었습니다.`, "success");
  } catch(err) {
    error.textContent = err.message;
    error.classList.remove("hidden");
  }
}

async function deleteFolderDirect(folderId, folderName, meetingCount){
  const childCount = foldersCache.filter(f => Number(f.parent_id) === Number(folderId)).length;
  const parts = [];
  if(meetingCount > 0) parts.push(`회의록 ${meetingCount}건`);
  if(childCount > 0) parts.push(`하위 폴더 ${childCount}개`);
  const detail = parts.length ? `\n${parts.join(", ")}은 한 단계 위 폴더로 이동합니다.` : "";
  if(!confirm(`"${folderName}" 폴더를 삭제할까요?${detail}`)) return;

  try {
    const result = await api(`/api/folders/${folderId}`, {method:"DELETE"});
    if(String(currentFolder) === String(folderId)){
      currentFolder = result.destination_parent_id == null ? "uncategorized" : String(result.destination_parent_id);
    }
    if(currentMeeting && Number(currentMeeting.folder_id) === Number(folderId)){
      currentMeeting.folder_id = result.destination_parent_id;
      const parent = foldersCache.find(f => Number(f.id) === Number(result.destination_parent_id));
      currentMeeting.folder_name = parent?.name || null;
      currentMeeting.folder_color = parent?.color || null;
      renderMeeting(currentMeeting);
    }
    await loadFolders();
    await loadMeetings($("#search").value);
    showToast(`"${folderName}" 폴더를 삭제했습니다.`, "success");
  } catch(err) {
    showToast("폴더 삭제 실패: " + err.message, "error");
  }
}

async function moveMeetingToFolder(meetingId, folderId, folderLabel=null){
  const status = $("#quickFolderStatus");
  const expectedFolderId = folderId == null ? null : Number(folderId);

  if(status && Number(meetingId) === Number(currentMeetingId)){
    status.textContent = "저장 중...";
  }

  try {
    const result = await api(`/api/meetings/${meetingId}/folder`, {
      method:"PATCH",
      body:JSON.stringify({folder_id:expectedFolderId})
    });

    if(!result.verified){
      throw new Error("서버가 회의록 위치 저장을 검증하지 못했습니다.");
    }

    const storedFolderId = result.folder_id == null ? null : Number(result.folder_id);
    if(storedFolderId !== expectedFolderId){
      throw new Error(`위치 저장 불일치: 요청 ${expectedFolderId}, 저장 ${storedFolderId}`);
    }

    // A second independent GET prevents a successful PATCH UI response from
    // masking a persistence/readback problem.
    const verifiedMeeting = await api(`/api/meetings/${meetingId}?lang=ko`);
    const readbackFolderId = verifiedMeeting.folder_id == null
      ? null
      : Number(verifiedMeeting.folder_id);

    if(readbackFolderId !== expectedFolderId){
      throw new Error(`DB 재조회 검증 실패: 요청 ${expectedFolderId}, 재조회 ${readbackFolderId}`);
    }

    if(Number(meetingId) === Number(currentMeetingId)){
      currentMeeting = verifiedMeeting;
      renderMeeting(currentMeeting);
    }

    await loadFolders();
    await loadMeetings($("#search").value);

    if(status && Number(meetingId) === Number(currentMeetingId)){
      status.textContent = "저장 완료";
      setTimeout(()=>status.textContent="", 1400);
    }

    showToast(
      `회의록을 "${folderLabel || result.folder_name || "미분류"}"에 저장했습니다.`,
      "success"
    );
    return verifiedMeeting;
  } catch(err) {
    if(status && Number(meetingId) === Number(currentMeetingId)){
      status.textContent = "저장 실패";
      setTimeout(()=>status.textContent="", 1800);
    }

    showToast("회의록 위치 저장 실패: " + err.message, "error");

    // Re-read server truth so UI never keeps a non-persisted folder position.
    try {
      const serverMeeting = await api(`/api/meetings/${meetingId}?lang=ko`);
      if(Number(meetingId) === Number(currentMeetingId)){
        currentMeeting = serverMeeting;
        renderMeeting(serverMeeting);
      }
      await loadFolders();
      await loadMeetings($("#search").value);
    } catch {}

    throw err;
  }
}
async function loadMeetings(q=""){
  const rows = await api("/api/meetings?q=" + encodeURIComponent(q) + "&folder=" + encodeURIComponent(currentFolder));

  const specificFolder = currentFolder !== "all" && currentFolder !== "uncategorized";
  const showInline = specificFolder && expandedMeetingFolderId === String(currentFolder);
  let target = listEl;

  if(specificFolder){
    listEl.innerHTML = "";
    listEl.classList.add("hidden");

    if(!showInline){
      emptyEl.classList.add("hidden");
      return;
    }

    let inline = document.querySelector(`.folder-inline-meetings[data-folder-id="${CSS.escape(String(currentFolder))}"]`);
    if(!inline){
      await loadFolders();
      inline = document.querySelector(`.folder-inline-meetings[data-folder-id="${CSS.escape(String(currentFolder))}"]`);
    }
    if(inline){
      target = inline;
    } else {
      return;
    }
  } else {
    listEl.classList.remove("hidden");
  }

  target.innerHTML = "";

  rows.forEach(m => {
    const btn = document.createElement("button");
    btn.className = showInline ? "inline-meeting-title" : "meeting-card";
    btn.draggable = true;
    btn.dataset.meetingId = String(m.id);

    btn.addEventListener("dragstart", e => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/meeting-id", String(m.id));
      btn.classList.add("dragging");
    });
    btn.addEventListener("dragend", () => btn.classList.remove("dragging"));

    if(m.id === currentMeetingId) btn.classList.add("active");

    if(showInline){
      // Folder children intentionally show only the meeting title.
      btn.textContent = m.title || "회의록";
      btn.title = m.title || "회의록";
    } else {
      const badges=["ko",...(m.translations||[])].map(x=>`<span class="mini-lang">${x.toUpperCase()}</span>`).join("");
      btn.innerHTML=`<strong>${escapeHtml(m.title)}</strong><span>${escapeHtml(fmtDate(m.recorded_at||m.created_at))}</span><small>${m.folder_name ? `<span class="folder-color-dot mini" style="background:${escapeHtml(m.folder_color||"#536878")}"></span>` + escapeHtml(m.folder_name) + " · " : ""}${m.author ? "작성자 " + escapeHtml(m.author) + " · " : ""}${escapeHtml(m.source||"")} ${badges}</small>`;
    }

    btn.onclick = () => openMeeting(m.id, "ko");
    target.appendChild(btn);
  });

  if(showInline && !rows.length){
    const empty = document.createElement("div");
    empty.className = "inline-meeting-empty";
    empty.textContent = "회의록 없음";
    target.appendChild(empty);
  }

  emptyEl.classList.toggle("hidden", rows.length !== 0 || !!currentMeetingId || specificFolder);
}
async function openMeeting(id, lang="ko"){
  hideCalendarDetail();
  const m=await api(`/api/meetings/${id}?lang=${lang}`);
  currentMeetingId=id; currentLanguage=lang; currentMeeting=m; renderMeeting(m);
  emptyEl.classList.add("hidden"); detailEl.classList.remove("hidden");
  await loadMeetings($("#search").value);
}

function formatFuDate(value){
  if(!value) return "-";
  const [y,m,d] = String(value).split("-");
  return `${y}.${m}.${d}`;
}

function formatFuPeriod(item){
  if(item.start_date && item.end_date) return `${formatFuDate(item.start_date)} ~ ${formatFuDate(item.end_date)}`;
  if(item.start_date) return `${formatFuDate(item.start_date)} ~`;
  if(item.end_date) return `~ ${formatFuDate(item.end_date)}`;
  return "-";
}

function createFollowUpEditorRow(containerId, data={}, mode="import"){
  const container = document.getElementById(containerId);
  const row = document.createElement("div");
  row.className = "follow-up-editor-row";
  const completed = (data.status || "open") === "completed";
  const selectedColor = String(data.color || "#64748B").toUpperCase();
  const colorOptions = FU_COLORS.map(c =>
    `<option value="${c.hex}"${c.hex === selectedColor ? " selected" : ""}>${escapeHtml(c.name)}</option>`
  ).join("");

  row.innerHTML = `
    <label class="fu-task-field">업무내용<input class="fu-task" value="${escapeHtml(data.task||"")}" placeholder="예: HD 설비 FAT 일정 확정"/></label>
    <label>담당자<input class="fu-owner" value="${escapeHtml(data.owner||"")}" placeholder="예: 홍길동"/></label>
    <label>시작일<input class="fu-start" type="date" value="${escapeHtml(data.start_date||"")}"/></label>
    <label>종료일<input class="fu-end" type="date" value="${escapeHtml(data.end_date||"")}"/></label>
    <label>상태<select class="fu-status"><option value="open"${completed ? "" : " selected"}>진행중</option><option value="completed"${completed ? " selected" : ""}>완료</option></select></label>
    <label>색상<select class="fu-color">${colorOptions}</select></label>
    <label>완료일<input class="fu-completed-date" type="date" value="${escapeHtml(data.completed_date||"")}"/></label>
    <label class="fu-completion-field">완료사항<input class="fu-completion-note" value="${escapeHtml(data.completion_note||"")}" placeholder="예: FAT 완료, 출하 승인"/></label>
    <input class="fu-memo" type="hidden" value="${escapeHtml(data.memo||"")}"/>
    <button class="fu-remove" type="button" title="F/U 삭제">×</button>`;

  const statusEl = row.querySelector(".fu-status");
  const completedDateEl = row.querySelector(".fu-completed-date");
  const completionNoteEl = row.querySelector(".fu-completion-note");
  const colorEl = row.querySelector(".fu-color");

  const syncCompletionState = () => {
    const done = statusEl.value === "completed";
    completedDateEl.disabled = !done;
    completionNoteEl.disabled = !done;
    row.classList.toggle("completed", done);
    if(!done) completedDateEl.value = "";
  };
  const syncColor = () => {
    row.style.setProperty("--fu-editor-color", colorEl.value || "#64748B");
  };
  syncCompletionState();
  syncColor();

  row.querySelector(".fu-remove").onclick = () => {
    row.remove();
    if(mode === "import") scheduleImportDraft();
    else editDirty = true;
  };

  row.querySelectorAll("input, select").forEach(el => {
    el.addEventListener("input", () => {
      if(mode === "import") scheduleImportDraft();
      else editDirty = true;
    });
    el.addEventListener("change", () => {
      if(el.classList.contains("fu-status")) syncCompletionState();
      if(el.classList.contains("fu-color")) syncColor();
      if(mode === "import") scheduleImportDraft();
      else editDirty = true;
    });
  });
  container.appendChild(row);
}
function setFollowUpEditor(containerId, items, mode="import"){
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  const list = Array.isArray(items) ? items : [];
  if(list.length){
    list.forEach(item => createFollowUpEditorRow(containerId, item, mode));
  } else {
    createFollowUpEditorRow(containerId, {}, mode);
  }
}

function collectFollowUpItems(containerId){
  return [...document.querySelectorAll(`#${containerId} .follow-up-editor-row`)].map(row => ({
    task: row.querySelector(".fu-task").value.trim(),
    owner: row.querySelector(".fu-owner").value.trim() || null,
    start_date: row.querySelector(".fu-start").value || null,
    end_date: row.querySelector(".fu-end").value || null,
    status: row.querySelector(".fu-status").value || "open",
    completed_date: row.querySelector(".fu-completed-date").value || null,
    completion_note: row.querySelector(".fu-completion-note").value.trim() || null,
    memo: row.querySelector(".fu-memo").value.trim() || null,
    color: row.querySelector(".fu-color").value || "#64748B",
  })).filter(item => item.task || item.owner || item.start_date || item.end_date || item.completion_note || item.memo);
}
function renderFollowUpItems(meeting){
  const container = $("#followUp");
  const legacy = $("#legacyFollowUp");
  container.innerHTML = "";
  const items = meeting.follow_up_items || [];

  if(items.length){
    legacy.classList.add("hidden");
    items.forEach(item => {
      const done = item.status === "completed";
      const card = document.createElement("div");
      card.className = "follow-up-card" + (done ? " completed" : "");
      card.style.borderLeft = `5px solid ${item.color || "#64748B"}`;
      card.innerHTML = `
        <div class="follow-up-task"><span class="fu-status-badge ${done ? "completed" : "open"}">${done ? "완료" : "진행중"}</span>${escapeHtml(item.task)}</div>
        <div class="follow-up-meta">
          <span><b>담당자</b>${escapeHtml(item.owner || "-")}</span>
          <span><b>기간</b>${escapeHtml(formatFuPeriod(item))}</span>
          <span><b>완료일</b>${escapeHtml(item.completed_date ? formatFuDate(item.completed_date) : "-")}</span>
        </div>
        ${done ? `<div class="follow-up-completion"><b>완료사항</b><div>${escapeHtml(item.completion_note || "완료")}</div></div>` : ""}`;
      container.appendChild(card);
    });
  } else if(meeting.follow_up){
    legacy.textContent = meeting.follow_up;
    legacy.classList.remove("hidden");
  } else {
    legacy.textContent = "등록된 F/U 사항이 없습니다.";
    legacy.classList.remove("hidden");
  }
}
function ymd(date){
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,"0");
  const d = String(date.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}

function monthKey(date){
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;
}

function itemCoversDate(item, day){
  const key = ymd(day);
  const start = item.start_date || item.end_date;
  const end = item.end_date || item.start_date;
  return !!start && !!end && start <= key && key <= end;
}

function showCalendarDetail(selectedDate=null){
  currentMeetingId = null;
  currentMeeting = null;
  emptyEl.classList.add("hidden");
  detailEl.classList.add("hidden");
  $("#calendarDetail").classList.remove("hidden");
  if(selectedDate) calendarDetailSelectedDate = selectedDate;
  renderCalendarDetail();
}

function hideCalendarDetail(){
  $("#calendarDetail").classList.add("hidden");
}

function renderCalendarDetailList(items, selectedDate=null){
  const list = $("#calendarDetailList");
  if(!list) return;
  list.innerHTML = "";
  $("#calendarDetailListTitle").textContent = selectedDate ? `${selectedDate} F/U` : "이번 달 F/U";
  $("#calendarDetailListCount").textContent = String(items.length);

  if(!items.length){
    list.innerHTML = `<div class="calendar-detail-empty">해당 기간의 F/U가 없습니다.</div>`;
    return;
  }

  items.forEach(item => {
    const done = item.status === "completed";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "calendar-detail-fu" + (done ? " completed" : "");
    btn.innerHTML = `
      <span class="calendar-detail-fu-color" style="background:${escapeHtml(item.color || item.folder_color || "#64748B")}"></span>
      <span class="calendar-detail-fu-body">
        <strong>${done ? "✓ " : ""}${escapeHtml(item.task)}</strong>
        <small>${escapeHtml(item.owner || "담당자 미정")} · ${escapeHtml(formatFuPeriod(item))}</small>
        <em>${escapeHtml(item.meeting_title || "")}${item.memo ? " · 메모 있음" : ""}</em>
      </span>`;
    btn.onclick = () => openFuMemoDialog(item);
    list.appendChild(btn);
  });
}

function renderCalendarDetail(){
  const panel = $("#calendarDetail");
  if(!panel || panel.classList.contains("hidden")) return;

  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);

  $("#calendarDetailMonthLabel").textContent = `${year}년 ${month + 1}월`;
  $("#calendarDetailTitle").textContent = `${year}년 ${month + 1}월 F/U 캘린더`;
  $("#calendarDetailCount").textContent = String(calendarItems.length);
  $("#calendarDetailOpenCount").textContent = String(calendarItems.filter(x => x.status !== "completed").length);
  $("#calendarDetailDoneCount").textContent = String(calendarItems.filter(x => x.status === "completed").length);

  const grid = $("#calendarDetailGrid");
  grid.innerHTML = "";

  for(let i=0; i<first.getDay(); i++){
    const blank = document.createElement("div");
    blank.className = "calendar-detail-day blank";
    grid.appendChild(blank);
  }

  const todayKey = ymd(new Date());

  for(let day=1; day<=last.getDate(); day++){
    const date = new Date(year, month, day);
    const key = ymd(date);
    const items = calendarItems.filter(item => itemCoversDate(item, date));

    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-detail-day";
    if(key === todayKey) cell.classList.add("today");
    if(calendarDetailSelectedDate === key) cell.classList.add("selected");
    if(items.length) cell.classList.add("has-followup");

    const head = document.createElement("div");
    head.className = "calendar-detail-day-head";
    head.innerHTML = `<strong>${day}</strong><span>${items.length ? items.length : ""}</span>`;
    cell.appendChild(head);

    const events = document.createElement("div");
    events.className = "calendar-detail-events";

    items.slice(0,4).forEach(item => {
      const event = document.createElement("div");
      event.className = "calendar-detail-event" + (item.status === "completed" ? " completed" : "");
      event.style.borderLeftColor = item.color || item.folder_color || "#64748B";
      event.innerHTML = `<span>${escapeHtml(item.task)}</span><small>${escapeHtml(item.owner || "")}</small>`;
      events.appendChild(event);
    });

    if(items.length > 4){
      const more = document.createElement("div");
      more.className = "calendar-detail-more";
      more.textContent = `+${items.length-4}개 더`;
      events.appendChild(more);
    }

    cell.appendChild(events);
    cell.onclick = () => {
      calendarDetailSelectedDate = key;
      renderCalendarDetail();
      renderCalendarDetailList(items, key);
    };
    grid.appendChild(cell);
  }

  if(calendarDetailSelectedDate){
    const selected = new Date(calendarDetailSelectedDate + "T00:00:00");
    if(selected.getFullYear() === year && selected.getMonth() === month){
      const selectedItems = calendarItems.filter(item => itemCoversDate(item, selected));
      renderCalendarDetailList(selectedItems, calendarDetailSelectedDate);
      return;
    }
  }

  calendarDetailSelectedDate = null;
  renderCalendarDetailList(calendarItems);
}

async function loadCalendar(){
  const month = monthKey(calendarCursor);
  try {
    const data = await api(`/api/follow-ups/calendar?month=${encodeURIComponent(month)}`);
    calendarItems = data.items || [];
    renderCalendar();
    renderCalendarDetail();
  } catch(err) {
    $("#calendarGrid").innerHTML = `<div class="calendar-error">캘린더 조회 실패</div>`;
    $("#calendarFollowUpList").innerHTML = `<div class="calendar-empty">${escapeHtml(err.message)}</div>`;
  }
}

function renderCalendar(){
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  $("#calendarMonthLabel").textContent = `${year}년 ${month+1}월`;
  $("#calendarFollowUpCount").textContent = String(calendarItems.length);

  const first = new Date(year, month, 1);
  const last = new Date(year, month+1, 0);
  const grid = $("#calendarGrid");
  grid.innerHTML = "";

  for(let i=0;i<first.getDay();i++){
    const blank = document.createElement("div");
    blank.className = "calendar-day blank";
    grid.appendChild(blank);
  }

  const todayKey = ymd(new Date());
  for(let day=1;day<=last.getDate();day++){
    const date = new Date(year, month, day);
    const key = ymd(date);
    const items = calendarItems.filter(item => itemCoversDate(item, date));
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-day";
    if(key === todayKey) cell.classList.add("today");
    if(items.length) cell.classList.add("has-followup");
    cell.innerHTML = `<span class="calendar-day-number">${day}</span>`;
    if(items.length){
      const dots = document.createElement("div");
      dots.className = "calendar-day-dots";
      items.slice(0,3).forEach(item => {
        const dot = document.createElement("span");
        dot.style.background = item.color || item.folder_color || "#64748B";
        dots.appendChild(dot);
      });
      if(items.length > 3){
        const more = document.createElement("small");
        more.textContent = `+${items.length-3}`;
        dots.appendChild(more);
      }
      cell.appendChild(dots);
      cell.title = items.map(i => `${i.task} · ${i.owner || "담당자 미정"}`).join("\n");
    }
    cell.onclick = () => renderCalendarFollowUpList(items.length ? items : calendarItems, key);
    grid.appendChild(cell);
  }

  if(($("#fuSearch")?.value || "").trim()){
    runFuSearch().catch(err => showToast("F/U 검색 실패: " + err.message, "error"));
  } else {
    $("#calendarFollowUpTitle").textContent = "이번 달 F/U";
    renderCalendarFollowUpList(calendarItems);
  }
}

function openFuMemoDialog(item){
  fuMemoTarget = item;
  $("#fuMemoTask").textContent = item.task || "F/U";
  $("#fuMemoMeta").textContent = [
    item.owner ? `담당자: ${item.owner}` : "담당자: 미정",
    `기간: ${formatFuPeriod(item)}`,
    item.status === "completed" ? "상태: 완료" : "상태: 진행중",
    item.meeting_title ? `연관 회의: ${item.meeting_title}` : null
  ].filter(Boolean).join(" · ");
  $("#fuMemoText").value = item.memo || "";
  $("#fuMemoStatus").textContent = "";
  $("#fuMemoStatus").classList.add("hidden");
  $("#fuMemoDialog").showModal();
  setTimeout(() => $("#fuMemoText").focus(), 0);
}

async function saveFuMemo(){
  if(!fuMemoTarget) throw new Error("F/U 항목을 찾을 수 없습니다.");
  const updated = await api(`/api/follow-ups/${fuMemoTarget.id}/memo`, {
    method:"PATCH",
    body:JSON.stringify({memo:$("#fuMemoText").value})
  });
  fuMemoTarget.memo = updated.memo || "";
  const cached = calendarItems.find(x => Number(x.id) === Number(fuMemoTarget.id));
  if(cached) cached.memo = updated.memo || "";
  return updated;
}

async function runFuSearch(){
  const query = ($("#fuSearch")?.value || "").trim();
  if(!query){
    $("#calendarFollowUpTitle").textContent = "이번 달 F/U";
    renderCalendarFollowUpList(calendarItems);
    return;
  }

  $("#calendarFollowUpTitle").textContent = "F/U 검색 결과";
  const data = await api(`/api/follow-ups/search?q=${encodeURIComponent(query)}`);
  renderCalendarFollowUpList(data.items || []);
}

function renderCalendarFollowUpList(items, selectedDate=null){
  const list = $("#calendarFollowUpList");
  list.innerHTML = "";
  if(selectedDate){
    $("#calendarFollowUpTitle").textContent = `${selectedDate} F/U`;
    $("#calendarFollowUpCount").textContent = String(items.length);
  } else {
    $("#calendarFollowUpCount").textContent = String(items.length);
  }

  if(!items.length){
    list.innerHTML = `<div class="calendar-empty">해당 기간의 F/U가 없습니다.</div>`;
    return;
  }

  items.forEach(item => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "calendar-fu-card";
    card.innerHTML = `
      <span class="calendar-fu-color" style="background:${escapeHtml(item.color || item.folder_color || "#64748B")}"></span>
      <span class="calendar-fu-main ${item.status === "completed" ? "completed" : ""}">
        <strong>${item.status === "completed" ? "✓ " : ""}${escapeHtml(item.task)}</strong>
        <small>${escapeHtml(item.owner || "담당자 미정")} · ${escapeHtml(formatFuPeriod(item))}</small>
        <em>${item.status === "completed" ? "완료" : "진행중"} · ${item.memo ? "메모 있음 · " : ""}${escapeHtml(item.meeting_title || "")}</em>
      </span>`;
    card.onclick = () => {
      openFuMemoDialog(item);
    };
    list.appendChild(card);
  });
}

function participantText(value){
  if(Array.isArray(value)) return value.filter(Boolean).join(", ");
  if(value == null || value === "") return "-";
  return String(value);
}

function safeText(value, fallback="-"){
  const text = value == null ? "" : String(value).trim();
  return text || fallback;
}

function renderMeeting(m){
  $("#title").textContent = m.title || "회의록";

  // Keep the top area compact. Full metadata lives in 회의개요.
  $("#meta").innerHTML = [
    m.folder_name ? `<span class="meta-folder"><span class="folder-color-dot" style="background:${escapeHtml(m.folder_color||"#536878")}"></span>${escapeHtml(m.folder_name)}</span>` : null,
    escapeHtml(fmtDate(m.recorded_at||m.created_at))
  ].filter(Boolean).join(" · ");

  $("#overviewTitle").textContent = safeText(m.title);
  $("#overviewDate").textContent = safeText(fmtDate(m.recorded_at || m.created_at));
  $("#overviewLocation").textContent = safeText(m.location);
  $("#overviewMethod").textContent = safeText(m.meeting_method);
  $("#overviewParticipants").textContent = participantText(m.participants);
  $("#overviewAuthor").textContent = safeText(m.author);
  $("#overviewPurpose").textContent = safeText(m.purpose);

  $("#summary").textContent = safeText(m.summary, "요약이 등록되지 않았습니다.");
  $("#transcript").textContent = safeText(m.transcript, "회의 세부사항이 등록되지 않았습니다.");
  renderFollowUpItems(m);

  if($("#quickFolderSelect")){
    populateFolderSelects();
    $("#quickFolderSelect").value = m.folder_id ? String(m.folder_id) : "";
  }
  updateLanguageButtons(m);
}

function updateLanguageButtons(m){
  const available=new Set(["ko",...(m.available_translations||[])]);
  $$(".lang-btn").forEach(btn=>{
    const lang=btn.dataset.lang;
    btn.classList.toggle("active",lang===currentLanguage);
    btn.classList.toggle("needs-translation",lang!=="ko"&&!available.has(lang));
    if(lang!=="ko" && !translationConfigured){
      btn.disabled = true;
      btn.title = "번역 API가 설정되지 않은 무료 테스트 모드입니다.";
    } else {
      btn.disabled = false;
      btn.title = lang!=="ko"&&!available.has(lang) ? "클릭하면 번역을 생성합니다" : "";
    }
  });
}

async function switchLanguage(lang){
  if(!currentMeetingId||lang===currentLanguage) return;
  const notice=$("#translationNotice"); notice.classList.add("hidden");
  try { await openMeeting(currentMeetingId,lang); }
  catch(e){
    if(lang==="ko") throw e;
    const label=lang==="en"?"영어":"일본어";
    notice.textContent=`${label} 번역을 생성하는 중입니다.`; notice.classList.remove("hidden"); setLanguageDisabled(true);
    try {
      await api(`/api/meetings/${currentMeetingId}/translate`,{method:"POST",body:JSON.stringify({target_language:lang,force_refresh:false})});
      await openMeeting(currentMeetingId,lang); notice.textContent=`${label} 번역이 생성되어 저장되었습니다.`; setTimeout(()=>notice.classList.add("hidden"),2500);
    } catch(err){ notice.textContent=`번역 생성 실패: ${err.message}`; }
    finally { setLanguageDisabled(false); }
  }
}
function setLanguageDisabled(disabled){ $$(".lang-btn").forEach(btn=>btn.disabled=disabled); }
$$(".lang-btn").forEach(btn=>btn.addEventListener("click",()=>switchLanguage(btn.dataset.lang)));

async function openImport(){
  $("#importForm").reset();
  $("#importStatus")?.classList.add("hidden");
  if($("#importStatus")) $("#importStatus").textContent = "";
  if($("#importSaveBtn")){
    $("#importSaveBtn").disabled = false;
    $("#importSaveBtn").textContent = "저장";
  }
  populateFolderSelects();
  $("#importAuthor").value = currentUser?.display_name || currentUser?.email || "";
  setFollowUpEditor("importFollowUpItems", [], "import");

  const restoredLocal = restoreImportDraft();
  if(!restoredLocal){
    const restoredServer = await restoreServerDraft();
    if(!restoredServer && currentFolder !== "all" && currentFolder !== "uncategorized"){
      $("#importFolder").value = String(currentFolder);
    }
  }
  importDialog.showModal();
}
$("#newBtn").onclick=openImport; $("#emptyNewBtn").onclick=openImport; $("#closeImport").onclick=()=>{ saveImportDraft(); importDialog.close(); }; $("#cancelImport").onclick=()=>{ saveImportDraft(); importDialog.close(); };
["#importTitle","#importDate","#importLocation","#importMethod","#importParticipants","#importAuthor","#importFolder","#importPurpose","#importSummary","#importTranscript"].forEach(sel => {
  const el = $(sel);
  if(el){
    el.addEventListener("input", scheduleImportDraft);
    el.addEventListener("change", scheduleImportDraft);
  }
});

$("#addImportFollowUp").onclick = () => createFollowUpEditorRow("importFollowUpItems", {}, "import");
$("#addEditFollowUp").onclick = () => { createFollowUpEditorRow("editFollowUpItems", {}, "edit"); editDirty = true; };

$("#importForm").addEventListener("submit",async(e)=>{
  e.preventDefault();
  const transcript = $("#importTranscript").value.trim();
  if(!transcript) return alert("회의 세부사항을 붙여넣어 주세요.");

  const status = $("#importStatus");
  const saveBtn = $("#importSaveBtn");
  if(status){
    status.textContent = "1/3 서버에 저장 중...";
    status.className = "save-status saving";
  }
  if(saveBtn){
    saveBtn.disabled = true;
    saveBtn.textContent = "저장 중...";
  }

  try {
    const created = await api("/api/meetings", {
      method:"POST",
      body:JSON.stringify({
        title:$("#importTitle").value.trim(),
        recorded_at:$("#importDate").value||null,
        transcript,
        summary:$("#importSummary").value.trim()||null,
        source:"manual",
        folder_id:$("#importFolder").value ? Number($("#importFolder").value) : null,
        author:$("#importAuthor").value.trim() || null,
        location:$("#importLocation").value.trim() || null,
        meeting_method:$("#importMethod").value.trim() || null,
        participants:$("#importParticipants").value.trim() || null,
        purpose:$("#importPurpose").value.trim() || null,
        follow_up_items:collectFollowUpItems("importFollowUpItems")
      })
    });

    if(!created?.id || created.saved !== true){
      throw new Error("서버가 저장 완료 확인값을 반환하지 않았습니다.");
    }

    if(status){
      status.textContent = `2/3 DB 저장 검증 중... (ID ${created.id})`;
    }

    // Read the same row back from DB before calling it saved.
    const verified = await api(`/api/meetings/${created.id}?lang=ko`);
    if(!verified || Number(verified.id) !== Number(created.id)){
      throw new Error(`DB 재조회 검증 실패 (ID ${created.id})`);
    }

    clearImportDraft();
    await deleteServerDraft();

    if(status){
      status.textContent = `저장 확인 완료 · 회의 ID ${created.id}`;
      status.className = "save-status success";
    }

    // Open the saved meeting first. List refresh may fail independently.
    currentMeetingId = created.id;
    currentLanguage = "ko";
    currentMeeting = verified;
    renderMeeting(verified);
    emptyEl.classList.add("hidden");
    detailEl.classList.remove("hidden");

    let listRefreshOk = true;
    try {
      await loadFolders();
      await loadMeetings($("#search").value);
      await loadCalendar();
    } catch(listErr) {
      listRefreshOk = false;
      console.error("List refresh after verified save failed:", listErr);
    }

    if(status && !listRefreshOk){
      status.textContent = `저장은 DB에서 확인됨 · ID ${created.id} · 목록 갱신만 실패`;
      status.className = "save-status warning";
    }

    setTimeout(()=>importDialog.close(), listRefreshOk ? 450 : 1400);
  } catch(err) {
    saveImportDraft();
    if(status){
      status.textContent = "저장 실패: " + err.message + " · 입력 내용은 브라우저에 임시저장했습니다.";
      status.className = "save-status error";
    }
    if(saveBtn){
      saveBtn.disabled = false;
      saveBtn.textContent = "다시 저장";
    }
  }
});

$("#editBtn").onclick=async()=>{
  if(!currentMeetingId) return; const m=await api(`/api/meetings/${currentMeetingId}?lang=ko`);
  populateFolderSelects();
  $("#editTitle").value=m.title||"";
  $("#editDate").value=toLocalInput(m.recorded_at);
  $("#editLocation").value=m.location||"";
  $("#editMethod").value=m.meeting_method||"";
  $("#editParticipants").value=participantText(m.participants).replace("-", "");
  $("#editAuthor").value=m.author||"";
  $("#editFolder").value=m.folder_id?String(m.folder_id):"";
  $("#editPurpose").value=m.purpose||"";
  $("#editSummary").value=m.summary||"";
  $("#editTranscript").value=m.transcript||"";
  const editFu = (m.follow_up_items && m.follow_up_items.length)
    ? m.follow_up_items
    : (m.follow_up ? [{task:m.follow_up, owner:null, start_date:null, end_date:null}] : []);
  setFollowUpEditor("editFollowUpItems", editFu, "edit");
  editDirty=false;
  $("#editAutoSaveStatus").textContent="20분마다 자동저장";
  editDialog.showModal();
};
$("#closeEdit").onclick=()=>editDialog.close(); $("#cancelEdit").onclick=()=>editDialog.close();
["#editTitle","#editDate","#editLocation","#editMethod","#editParticipants","#editAuthor","#editFolder","#editPurpose","#editSummary","#editTranscript"].forEach(sel => {
  const el = $(sel);
  if(el){
    el.addEventListener("input", () => { editDirty = true; });
    el.addEventListener("change", () => { editDirty = true; });
  }
});

$("#editForm").addEventListener("submit",async(e)=>{
  e.preventDefault();
  const m=await api(`/api/meetings/${currentMeetingId}`,{method:"PUT",body:JSON.stringify({
    title:$("#editTitle").value.trim(),
    recorded_at:$("#editDate").value||null,
    location:$("#editLocation").value.trim()||null,
    meeting_method:$("#editMethod").value.trim()||null,
    participants:$("#editParticipants").value.trim()||null,
    author:$("#editAuthor").value.trim()||null,
    folder_id:$("#editFolder").value?Number($("#editFolder").value):null,
    purpose:$("#editPurpose").value.trim()||null,
    summary:$("#editSummary").value.trim()||null,
    transcript:$("#editTranscript").value,
    follow_up_items:collectFollowUpItems("editFollowUpItems")
  })});
  editDirty=false; $("#editAutoSaveStatus").textContent=`저장 완료 · ${new Date().toLocaleTimeString()}`; editDialog.close(); await loadFolders(); await loadCalendar(); await openMeeting(m.id,"ko");
});

$("#closeFuMemo").onclick = () => $("#fuMemoDialog").close();
$("#cancelFuMemo").onclick = () => $("#fuMemoDialog").close();

$("#fuMemoForm").addEventListener("submit", async e => {
  e.preventDefault();
  const status = $("#fuMemoStatus");
  status.classList.remove("hidden");
  status.className = "save-status saving";
  status.textContent = "메모 저장 중...";
  try {
    await saveFuMemo();
    status.className = "save-status success";
    status.textContent = "메모를 저장했습니다.";
    await loadCalendar();
    setTimeout(() => $("#fuMemoDialog").close(), 450);
  } catch(err) {
    status.className = "save-status error";
    status.textContent = "메모 저장 실패: " + err.message;
  }
});

$("#goFuMeeting").onclick = async () => {
  if(!fuMemoTarget) return;
  const meetingId = fuMemoTarget.meeting_id;
  $("#fuMemoDialog").close();
  await openMeeting(meetingId, "ko");
};

$("#fuSearch").addEventListener("input", () => {
  clearTimeout(fuSearchTimer);
  fuSearchTimer = setTimeout(() => {
    runFuSearch().catch(err => showToast("F/U 검색 실패: " + err.message, "error"));
  }, 220);
});

$("#openCalendarDetail").onclick = () => showCalendarDetail();
$("#calendarMonthLabel").onclick = () => showCalendarDetail();

$("#calendarDetailPrev").onclick = async () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth()-1, 1);
  calendarDetailSelectedDate = null;
  await loadCalendar();
};
$("#calendarDetailNext").onclick = async () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth()+1, 1);
  calendarDetailSelectedDate = null;
  await loadCalendar();
};
$("#calendarDetailToday").onclick = async () => {
  const now = new Date();
  calendarCursor = new Date(now.getFullYear(), now.getMonth(), 1);
  calendarDetailSelectedDate = ymd(now);
  await loadCalendar();
};

$("#calendarPrev").onclick = async () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth()-1, 1);
  await loadCalendar();
};
$("#calendarNext").onclick = async () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth()+1, 1);
  await loadCalendar();
};
$("#calendarToday").onclick = async () => {
  const now = new Date();
  calendarCursor = new Date(now.getFullYear(), now.getMonth(), 1);
  await loadCalendar();
};

$("#search").addEventListener("input",e=>{ clearTimeout(debounceTimer); debounceTimer=setTimeout(()=>loadMeetings(e.target.value),250); });
$("#shareBtn").onclick=()=>{ $("#shareResult").classList.add("hidden"); $("#shareUrl").value=""; shareDialog.showModal(); };
$("#closeShare").onclick=()=>shareDialog.close(); $("#cancelShare").onclick=()=>shareDialog.close();
$("#shareForm").addEventListener("submit",async(e)=>{
  e.preventDefault(); if(!currentMeetingId) return; const selected=$("#expires").value;
  const data=await api(`/api/meetings/${currentMeetingId}/share`,{method:"POST",body:JSON.stringify({expires_hours:selected==="none"?null:Number(selected)})});
  $("#shareUrl").value=location.origin+data.url; $("#shareResult").classList.remove("hidden");
});
$("#copyShare").onclick=async()=>{ await navigator.clipboard.writeText($("#shareUrl").value); $("#copyShare").textContent="복사됨"; setTimeout(()=>$("#copyShare").textContent="복사",1200); };

const passwordDialog = $("#passwordDialog");
const adminDialog = $("#adminDialog");

$("#passwordBtn").onclick = () => {
  $("#passwordForm").reset();
  $("#passwordError").classList.add("hidden");
  passwordDialog.showModal();
};
$("#closePassword").onclick = () => passwordDialog.close();
$("#cancelPassword").onclick = () => passwordDialog.close();
$("#passwordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const error = $("#passwordError");
  error.classList.add("hidden");
  try {
    await api("/api/auth/change-password", {
      method:"POST",
      body:JSON.stringify({
        current_password: $("#currentPassword").value,
        new_password: $("#newPassword").value
      })
    });
    alert("비밀번호가 변경되었습니다. 다시 로그인해 주세요.");
    location.replace("/login.html");
  } catch(err) {
    error.textContent = err.message;
    error.classList.remove("hidden");
  }
});

async function loadAdminUsers(){
  const rows = await api("/api/admin/users");
  const el = $("#adminUserList");
  el.innerHTML = "";
  rows.forEach(u => {
    const item = document.createElement("div");
    item.className = "admin-user-row";
    item.innerHTML = `
      <div class="admin-user-main">
        <strong>${escapeHtml(u.display_name || u.email)}</strong>
        <span>${escapeHtml(u.email)}</span>
        <small>${u.is_admin ? "관리자" : "사용자"} · ${u.is_active ? "활성" : "비활성"}</small>
      </div>
      <div class="admin-user-controls">
        ${u.id === currentUser.id ? '<span class="self-badge">현재 계정</span>' :
          `<button class="secondary toggle-user">${u.is_active ? "비활성화" : "활성화"}</button>
           <button class="secondary reset-user">비밀번호 초기화</button>`}
      </div>`;
    if(u.id !== currentUser.id){
      item.querySelector(".toggle-user").onclick = async () => {
        await api(`/api/admin/users/${u.id}`, {
          method:"PATCH",
          body:JSON.stringify({is_active:!u.is_active})
        });
        await loadAdminUsers();
      };
      item.querySelector(".reset-user").onclick = async () => {
        const pw = prompt(`${u.email}의 새 비밀번호를 입력하세요.\n형식 제한은 없으며 빈 값만 사용할 수 없습니다.`);
        if(!pw) return;
        try {
          await api(`/api/admin/users/${u.id}`, {
            method:"PATCH",
            body:JSON.stringify({new_password:pw})
          });
          alert("비밀번호를 초기화했습니다. 기존 로그인 세션도 종료됩니다.");
        } catch(err) {
          alert(err.message);
        }
      };
    }
    el.appendChild(item);
  });
}

$("#adminBtn").onclick = async () => {
  $("#createUserForm").reset();
  $("#adminError").classList.add("hidden");
  adminDialog.showModal();
  try { await loadAdminUsers(); } catch(err) {
    $("#adminError").textContent = err.message;
    $("#adminError").classList.remove("hidden");
  }
};
$("#closeAdmin").onclick = () => adminDialog.close();

$("#createUserForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const error = $("#adminError");
  error.classList.add("hidden");
  try {
    await api("/api/admin/users", {
      method:"POST",
      body:JSON.stringify({
        display_name: $("#adminDisplayName").value.trim() || null,
        email: $("#adminEmail").value.trim(),
        password: $("#adminPassword").value
      })
    });
    $("#createUserForm").reset();
    await loadAdminUsers();
  } catch(err) {
    error.textContent = err.message;
    error.classList.remove("hidden");
  }
});



const folderRootDropZone = $("#folderRootDropZone");
folderRootDropZone.addEventListener("dragover", e => {
  if(e.dataTransfer.types.includes("application/x-folder-id")){
    e.preventDefault();
    folderRootDropZone.classList.add("drag-over");
  }
});
folderRootDropZone.addEventListener("dragleave", () => folderRootDropZone.classList.remove("drag-over"));
folderRootDropZone.addEventListener("drop", async e => {
  e.preventDefault();
  folderRootDropZone.classList.remove("drag-over");
  const folderId = Number(e.dataTransfer.getData("application/x-folder-id"));
  if(folderId){
    try { await moveFolderToParent(folderId, null); }
    catch(err){ showToast("폴더 이동 실패: " + err.message, "error"); }
  }
});

$("#closeFolderRename").onclick = () => $("#folderRenameDialog").close();
$("#cancelFolderRename").onclick = () => $("#folderRenameDialog").close();
$("#folderRenameForm").addEventListener("submit", async e => {
  e.preventDefault();
  const error = $("#folderRenameError");
  error.classList.add("hidden");
  try {
    if(!folderRenameTarget) throw new Error("수정할 폴더를 찾을 수 없습니다.");
    const updated = await renameFolderInline(folderRenameTarget, $("#folderRenameName").value);
    folderRenameTarget = updated;
    $("#folderRenameDialog").close();
    showToast(`폴더명을 "${updated.name}"으로 변경했습니다.`, "success");
  } catch(err) {
    error.textContent = err.message;
    error.classList.remove("hidden");
  }
});

$("#closeFolderMove").onclick = () => $("#folderMoveDialog").close();
$("#cancelFolderMove").onclick = () => $("#folderMoveDialog").close();
$("#folderMoveForm").addEventListener("submit", async e => {
  e.preventDefault();
  const error = $("#folderMoveError");
  error.classList.add("hidden");
  try {
    if(!folderMoveTarget) throw new Error("이동할 폴더를 찾을 수 없습니다.");
    const value = $("#folderMoveParent").value;
    await moveFolderToParent(folderMoveTarget.id, value ? Number(value) : null);
    $("#folderMoveDialog").close();
  } catch(err) {
    error.textContent = err.message;
    error.classList.remove("hidden");
  }
});

$("#contextRenameFolder").onclick = () => {
  if(!folderContextTarget) return;
  const target = folderContextTarget;
  closeFolderContextMenu();
  openFolderRenameDialog(target);
};
$("#contextAddChild").onclick = () => {
  if(!folderContextTarget) return;
  const target = folderContextTarget;
  closeFolderContextMenu();
  openFolderCreateForParent(target.id);
};
$("#contextMoveRoot").onclick = async () => {
  if(!folderContextTarget) return;
  const target = folderContextTarget;
  closeFolderContextMenu();
  try { await moveFolderToParent(target.id, null); }
  catch(err){ showToast("폴더 이동 실패: " + err.message, "error"); }
};
$("#contextDeleteFolder").onclick = async () => {
  if(!folderContextTarget) return;
  const target = folderContextTarget;
  closeFolderContextMenu();
  await deleteFolderDirect(Number(target.id), target.name, Number(target.meeting_count || 0));
};
document.addEventListener("click", e => { if(!e.target.closest("#folderContextMenu")) closeFolderContextMenu(); });
document.addEventListener("scroll", closeFolderContextMenu, true);
window.addEventListener("resize", closeFolderContextMenu);
document.addEventListener("keydown", e => { if(e.key === "Escape") closeFolderContextMenu(); });

$("#sidebarToggle").onclick = () => {
  const collapsed = $("#appRoot").classList.contains("sidebar-collapsed");
  setSidebarCollapsed(!collapsed);
};

$("#showFolderCreateBtn").onclick = () => openFolderCreateForParent(null);

$("#closeFolderCreate").onclick = () => $("#folderCreateDialog").close();
$("#cancelFolderCreate").onclick = () => $("#folderCreateDialog").close();

$("#folderCreateForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  await createFolderInline($("#folderCreateName").value);
});

$("#closeFolderColor").onclick = () => $("#folderColorDialog").close();

$("#quickFolderSelect").addEventListener("change", async (e) => {
  if(!currentMeetingId) return;
  const value = e.target.value;
  const folderId = value ? Number(value) : null;
  const label = value ? folderDisplayLabel(value) : "미분류";
  await moveMeetingToFolder(currentMeetingId, folderId, label);
});

$("#logoutBtn").onclick=async()=>{ await fetch(apiUrl("/api/auth/logout"),{method:"POST",credentials:"include"}); location.replace("/login.html"); };

(async function boot(){
  restoreSidebarState();
  if(!(await requireLogin())) return;
  try {
    const h = await fetch(apiUrl("/api/health"), {credentials:"include"});
    if(h.ok){
      const health = await h.json();
      translationConfigured = !!health.translation_configured;
if(!translationConfigured){
        const notice = $("#translationNotice");
        notice.textContent = "현재 무료 테스트 모드에서는 영어·일본어 자동 번역이 비활성화되어 있습니다.";
        notice.classList.remove("hidden");
      }
    }
  } catch {}
  await loadFolders();
  await loadCalendar();
  try {
    await loadMeetings();
  } catch(err) {
    const banner = $("#appErrorBanner");
    banner.textContent = "회의록 목록 조회 실패: " + err.message;
    banner.classList.remove("hidden");
  }
  setInterval(autoSaveTick, AUTO_SAVE_INTERVAL_MS);
})();
