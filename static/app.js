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
    transcript: $("#importTranscript")?.value || "",
    summary: $("#importSummary")?.value || "",
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
    $("#importTranscript").value = d.transcript || "";
    $("#importSummary").value = d.summary || "";
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

function clearImportDraft(){
  try { localStorage.removeItem(IMPORT_DRAFT_KEY); } catch {}
  const el = $("#draftStatus");
  if(el){
    el.textContent = "";
    el.classList.add("hidden");
  }
}

async function loadStorageStatus(){
  const el = $("#storageStatus");
  if(!el) return;
  try {
    const s = await api("/api/storage/status");
    if(s.persistent){
      el.textContent = `DB: PostgreSQL · 저장 ${s.meeting_count}건`;
      el.className = "storage-status persistent";
    } else {
      el.textContent = `DB: SQLite 임시저장 · ${s.meeting_count}건`;
      el.className = "storage-status ephemeral";
    }
  } catch(err) {
    el.textContent = "DB 상태 확인 실패";
    el.className = "storage-status error";
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
      currentMeetingId = null;
      currentMeeting = null;
      detailEl.classList.add("hidden");
      renderFolders(data);
      await loadMeetings($("#search").value);
    };
    row.appendChild(btn);

    if(value === "uncategorized"){
      row.classList.add("folder-drop-target");
      row.addEventListener("dragover", e => { e.preventDefault(); row.classList.add("drag-over"); });
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
    row.className = "folder-row folder-drop-target" + (String(currentFolder) === String(f.id) ? " active" : "");
    row.style.setProperty("--folder-depth", depth);
    row.dataset.folderValue = String(f.id);

    row.addEventListener("dragover", e => { e.preventDefault(); row.classList.add("drag-over"); });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", async e => {
      e.preventDefault();
      row.classList.remove("drag-over");
      const meetingId = Number(e.dataTransfer.getData("text/meeting-id"));
      if(meetingId) await moveMeetingToFolder(meetingId, Number(f.id), f.name);
    });

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "folder-filter-btn tree-folder-btn";
    btn.style.paddingLeft = `${8 + depth * 16}px`;
    btn.innerHTML = `
      <span class="folder-color-dot" style="background:${escapeHtml(f.color || "#4F6B8A")}"></span>
      <span class="folder-label">${escapeHtml(f.name)}</span>
      <span class="folder-count">${Number(f.meeting_count || 0)}</span>`;
    btn.ondblclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await renameFolderInline(f);
    };
    btn.onclick = async () => {
      currentFolder = String(f.id);
      currentMeetingId = null;
      currentMeeting = null;
      detailEl.classList.add("hidden");
      renderFolders(data);
      await loadMeetings($("#search").value);
    };
    row.appendChild(btn);

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "folder-edit-btn";
    edit.textContent = "✎";
    edit.title = `"${f.name}" 폴더명 수정`;
    edit.setAttribute("aria-label", `"${f.name}" 폴더명 수정`);
    edit.onclick = async e => {
      e.stopPropagation();
      await renameFolderInline(f);
    };
    row.appendChild(edit);

    const color = document.createElement("input");
    color.type = "color";
    color.className = "folder-row-color";
    color.value = f.color || "#4F6B8A";
    color.title = `"${f.name}" 색상`;
    color.onclick = e => e.stopPropagation();
    color.onchange = async e => {
      e.stopPropagation();
      await updateFolderAppearance(f, e.target.value);
    };
    row.appendChild(color);

    const child = document.createElement("button");
    child.type = "button";
    child.className = "folder-child-btn";
    child.textContent = "+";
    child.title = `"${f.name}" 아래 하위 폴더 추가`;
    child.onclick = e => {
      e.stopPropagation();
      openFolderCreateForParent(f.id, f.color || "#4F6B8A");
    };
    row.appendChild(child);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "folder-delete-btn";
    del.textContent = "×";
    del.title = `"${f.name}" 폴더 삭제`;
    del.onclick = async e => {
      e.stopPropagation();
      await deleteFolderDirect(Number(f.id), f.name, Number(f.meeting_count || 0));
    };
    row.appendChild(del);

    folderListEl.appendChild(row);

    (children.get(String(f.id)) || []).forEach(c => addFolderRow(c, depth + 1));
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

function openFolderCreateForParent(parentId=null, suggestedColor="#4F6B8A"){
  $("#inlineFolderForm").classList.remove("hidden");
  $("#folderInlineError").classList.add("hidden");
  populateFolderParentSelect();
  $("#inlineFolderParent").value = parentId == null ? "" : String(parentId);
  $("#inlineFolderColor").value = suggestedColor || "#4F6B8A";
  $("#inlineFolderName").focus();
}

function populateFolderParentSelect(){
  const sel = $("#inlineFolderParent");
  if(!sel) return;
  const previous = sel.value;
  sel.innerHTML = `<option value="">최상위 폴더</option>`;
  sortedFolderTree().forEach(({folder, depth}) => {
    const opt = document.createElement("option");
    opt.value = String(folder.id);
    opt.textContent = `${"— ".repeat(depth)}${folder.name}`;
    sel.appendChild(opt);
  });
  if([...sel.options].some(o => o.value === previous)) sel.value = previous;
}

async function renameFolderInline(folder){
  const nextName = prompt("새 폴더명을 입력하세요.", folder.name);
  if(nextName === null) return;

  const cleanName = nextName.trim();
  if(!cleanName){
    showToast("폴더명은 비워둘 수 없습니다.", "error");
    return;
  }
  if(cleanName === folder.name) return;

  try {
    await api(`/api/folders/${folder.id}`, {
      method:"PATCH",
      body:JSON.stringify({
        name:cleanName,
        parent_id:folder.parent_id,
        color:folder.color || "#4F6B8A"
      })
    });

    if(currentMeeting && Number(currentMeeting.folder_id) === Number(folder.id)){
      currentMeeting.folder_name = cleanName;
      renderMeeting(currentMeeting);
    }

    await loadFolders();
    await loadMeetings($("#search").value);
    showToast(`폴더명을 "${cleanName}"으로 변경했습니다.`, "success");
  } catch(err) {
    showToast("폴더명 변경 실패: " + err.message, "error");
  }
}

async function updateFolderAppearance(folder, color){
  try {
    await api(`/api/folders/${folder.id}`, {
      method:"PATCH",
      body:JSON.stringify({
        name:folder.name,
        parent_id:folder.parent_id,
        color
      })
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
  populateFolderParentSelect();

  if(currentMeeting && $("#quickFolderSelect")){
    $("#quickFolderSelect").value = currentMeeting.folder_id ? String(currentMeeting.folder_id) : "";
  }
}

async function createFolderInline(name){
  const cleanName = String(name || "").trim();
  if(!cleanName) return;

  const error = $("#folderInlineError");
  error.classList.add("hidden");
  const parentValue = $("#inlineFolderParent").value;
  const parentId = parentValue ? Number(parentValue) : null;
  const color = $("#inlineFolderColor").value || "#4F6B8A";

  try {
    const f = await api("/api/folders", {
      method:"POST",
      body:JSON.stringify({
        name:cleanName,
        parent_id:parentId,
        color
      })
    });
    $("#inlineFolderName").value = "";
    $("#inlineFolderForm").classList.add("hidden");
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
  if(status && Number(meetingId) === Number(currentMeetingId)){
    status.textContent = "이동 중...";
  }

  try {
    const result = await api(`/api/meetings/${meetingId}/folder`, {
      method:"PATCH",
      body:JSON.stringify({folder_id:folderId})
    });

    if(Number(meetingId) === Number(currentMeetingId) && currentMeeting){
      currentMeeting.folder_id = result.folder_id;
      currentMeeting.folder_name = result.folder_name;
      renderMeeting(currentMeeting);
    }

    await loadFolders();
    await loadMeetings($("#search").value);

    if(status && Number(meetingId) === Number(currentMeetingId)){
      status.textContent = "이동 완료";
      setTimeout(()=>status.textContent="", 1200);
    }

    showToast(`회의록을 "${folderLabel || result.folder_name || "미분류"}"로 이동했습니다.`, "success");
  } catch(err) {
    if(status && Number(meetingId) === Number(currentMeetingId)){
      status.textContent = "이동 실패";
      setTimeout(()=>status.textContent="", 1600);
    }
    showToast("회의록 이동 실패: " + err.message, "error");
    if(currentMeeting && Number(meetingId) === Number(currentMeetingId)){
      $("#quickFolderSelect").value = currentMeeting.folder_id ? String(currentMeeting.folder_id) : "";
    }
  }
}

async function loadMeetings(q=""){
  const rows = await api("/api/meetings?q=" + encodeURIComponent(q) + "&folder=" + encodeURIComponent(currentFolder));
  listEl.innerHTML = "";
  rows.forEach(m => {
    const btn=document.createElement("button"); btn.className="meeting-card";
    btn.draggable = true;
    btn.dataset.meetingId = String(m.id);
    btn.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/meeting-id", String(m.id));
      btn.classList.add("dragging");
    });
    btn.addEventListener("dragend", () => btn.classList.remove("dragging"));
    if(m.id===currentMeetingId) btn.classList.add("active");
    const badges=["ko",...(m.translations||[])].map(x=>`<span class="mini-lang">${x.toUpperCase()}</span>`).join("");
    btn.innerHTML=`<strong>${escapeHtml(m.title)}</strong><span>${escapeHtml(fmtDate(m.recorded_at||m.created_at))}</span><small>${m.folder_name ? `<span class="folder-color-dot mini" style="background:${escapeHtml(m.folder_color||"#4F6B8A")}"></span>` + escapeHtml(m.folder_name) + " · " : ""}${m.author ? "작성자 " + escapeHtml(m.author) + " · " : ""}${escapeHtml(m.source||"")} ${badges}</small>`;
    btn.onclick=()=>openMeeting(m.id,"ko"); listEl.appendChild(btn);
  });
  emptyEl.classList.toggle("hidden", rows.length !== 0 || !!currentMeetingId);
}

async function openMeeting(id, lang="ko"){
  const m=await api(`/api/meetings/${id}?lang=${lang}`);
  currentMeetingId=id; currentLanguage=lang; currentMeeting=m; renderMeeting(m);
  emptyEl.classList.add("hidden"); detailEl.classList.remove("hidden");
  await loadMeetings($("#search").value);
}

function renderMeeting(m){
  $("#title").textContent=m.title;
  $("#meta").innerHTML=[
    m.folder_name ? `<span class="meta-folder"><span class="folder-color-dot" style="background:${escapeHtml(m.folder_color||"#4F6B8A")}"></span>${escapeHtml(m.folder_name)}</span>` : null,
    m.author ? `작성자: ${escapeHtml(m.author)}` : null,
    escapeHtml(fmtDate(m.recorded_at||m.created_at)),
    escapeHtml(m.source||"")
  ].filter(Boolean).join(" · ");
  $("#summary").textContent=m.summary||"요약이 등록되지 않았습니다.";
  $("#transcript").textContent=m.transcript;
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

function openImport(){
  $("#importForm").reset();
  $("#importStatus")?.classList.add("hidden");
  if($("#importStatus")) $("#importStatus").textContent = "";
  if($("#importSaveBtn")){
    $("#importSaveBtn").disabled = false;
    $("#importSaveBtn").textContent = "저장";
  }
  populateFolderSelects();
  $("#importAuthor").value = currentUser?.display_name || currentUser?.email || "";
  const restored = restoreImportDraft();
  if(!restored && currentFolder !== "all" && currentFolder !== "uncategorized"){
    $("#importFolder").value = String(currentFolder);
  }
  importDialog.showModal();
}
$("#newBtn").onclick=openImport; $("#emptyNewBtn").onclick=openImport; $("#closeImport").onclick=()=>{ saveImportDraft(); importDialog.close(); }; $("#cancelImport").onclick=()=>{ saveImportDraft(); importDialog.close(); };
["#importTitle","#importDate","#importAuthor","#importFolder","#importTranscript","#importSummary"].forEach(sel => {
  const el = $(sel);
  if(el){
    el.addEventListener("input", scheduleImportDraft);
    el.addEventListener("change", scheduleImportDraft);
  }
});

$("#importForm").addEventListener("submit",async(e)=>{
  e.preventDefault();
  const transcript = $("#importTranscript").value.trim();
  if(!transcript) return alert("전사 내용 또는 전사 파일이 필요합니다.");

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
        author:$("#importAuthor").value.trim() || null
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
      await loadStorageStatus();
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
  populateFolderSelects(); $("#editTitle").value=m.title||""; $("#editDate").value=toLocalInput(m.recorded_at); $("#editFolder").value=m.folder_id?String(m.folder_id):""; $("#editAuthor").value=m.author||""; $("#editSummary").value=m.summary||""; $("#editTranscript").value=m.transcript||""; editDialog.showModal();
};
$("#closeEdit").onclick=()=>editDialog.close(); $("#cancelEdit").onclick=()=>editDialog.close();
$("#editForm").addEventListener("submit",async(e)=>{
  e.preventDefault();
  const m=await api(`/api/meetings/${currentMeetingId}`,{method:"PUT",body:JSON.stringify({title:$("#editTitle").value.trim(),recorded_at:$("#editDate").value||null,summary:$("#editSummary").value.trim()||null,transcript:$("#editTranscript").value,participants:currentMeeting?.participants||null,folder_id:$("#editFolder").value?Number($("#editFolder").value):null,author:$("#editAuthor").value.trim()||null})});
  editDialog.close(); await loadFolders(); await openMeeting(m.id,"ko");
});

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
        const pw = prompt(`${u.email}의 새 비밀번호를 입력하세요.\n12자 이상, 대/소문자와 숫자를 포함해야 합니다.`);
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



$("#showFolderCreateBtn").onclick = () => {
  if($("#inlineFolderForm").classList.contains("hidden")){
    openFolderCreateForParent(null, "#4F6B8A");
  } else {
    $("#inlineFolderForm").classList.add("hidden");
  }
};

$("#cancelInlineFolder").onclick = () => {
  $("#inlineFolderForm").classList.add("hidden");
  $("#inlineFolderName").value = "";
  $("#inlineFolderParent").value = "";
  $("#inlineFolderColor").value = "#4F6B8A";
  $("#folderInlineError").classList.add("hidden");
};

$("#inlineFolderForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  await createFolderInline($("#inlineFolderName").value);
});

$("#inlineFolderName").addEventListener("keydown", (e) => {
  if(e.key === "Escape"){
    $("#cancelInlineFolder").click();
  }
});

$("#quickFolderSelect").addEventListener("change", async (e) => {
  if(!currentMeetingId) return;
  const value = e.target.value;
  const folderId = value ? Number(value) : null;
  const label = value ? folderDisplayLabel(value) : "미분류";
  await moveMeetingToFolder(currentMeetingId, folderId, label);
});

$("#logoutBtn").onclick=async()=>{ await fetch(apiUrl("/api/auth/logout"),{method:"POST",credentials:"include"}); location.replace("/login.html"); };

(async function boot(){
  if(!(await requireLogin())) return;
  try {
    const h = await fetch(apiUrl("/api/health"), {credentials:"include"});
    if(h.ok){
      const health = await h.json();
      translationConfigured = !!health.translation_configured;
      if(health.storage_backend){
        console.info("Meeting storage backend:", health.storage_backend);
      }
      if(!translationConfigured){
        const notice = $("#translationNotice");
        notice.textContent = "현재 무료 테스트 모드에서는 영어·일본어 자동 번역이 비활성화되어 있습니다.";
        notice.classList.remove("hidden");
      }
    }
  } catch {}
  await loadFolders();
  try {
    await loadMeetings();
  } catch(err) {
    const banner = $("#appErrorBanner");
    banner.textContent = "회의록 목록 조회 실패: " + err.message;
    banner.classList.remove("hidden");
  }
})();
