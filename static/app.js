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

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const API_BASE_URL = String(window.APP_CONFIG?.API_BASE_URL || "").replace(/\/$/, "");
const apiUrl = (path) => `${API_BASE_URL}${path}`;
const listEl = $("#meetingList");
const detailEl = $("#detail");
const emptyEl = $("#empty");
const importDialog = $("#importDialog");
const editDialog = $("#editDialog");
const shareDialog = $("#shareDialog");

function loginUrl(){ return "/login.html?next=" + encodeURIComponent(location.pathname + location.search + location.hash); }

async function api(path, options={}) {
  const res = await fetch(apiUrl(path), {credentials:"include", headers:{"Content-Type":"application/json", ...(options.headers||{})}, ...options});
  if (res.status === 401) { location.replace(loginUrl()); throw new Error("로그인이 필요합니다."); }
  if (!res.ok) {
    let msg = "요청에 실패했습니다.";
    try { msg = (await res.json()).detail || msg; } catch {}
    throw new Error(msg);
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

async function loadMeetings(q=""){
  const rows = await api("/api/meetings?q=" + encodeURIComponent(q));
  listEl.innerHTML = "";
  rows.forEach(m => {
    const btn=document.createElement("button"); btn.className="meeting-card";
    if(m.id===currentMeetingId) btn.classList.add("active");
    const badges=["ko",...(m.translations||[])].map(x=>`<span class="mini-lang">${x.toUpperCase()}</span>`).join("");
    btn.innerHTML=`<strong>${escapeHtml(m.title)}</strong><span>${escapeHtml(fmtDate(m.recorded_at||m.created_at))}</span><small>${escapeHtml(m.source||"")} ${badges}</small>`;
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
  $("#meta").textContent=[fmtDate(m.recorded_at||m.created_at),m.source].filter(Boolean).join(" · ");
  $("#summary").textContent=m.summary||"요약이 등록되지 않았습니다.";
  $("#transcript").textContent=m.transcript; updateLanguageButtons(m);
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

function openImport(){ $("#importForm").reset(); importDialog.showModal(); }
$("#newBtn").onclick=openImport; $("#emptyNewBtn").onclick=openImport; $("#closeImport").onclick=()=>importDialog.close(); $("#cancelImport").onclick=()=>importDialog.close();
$("#fileInput").addEventListener("change",async(e)=>{ const f=e.target.files?.[0]; if(!f) return; $("#importTranscript").value=await f.text(); if(!$("#importTitle").value) $("#importTitle").value=f.name.replace(/\.(txt|srt|md)$/i,""); });
$("#importForm").addEventListener("submit",async(e)=>{
  e.preventDefault(); const transcript=$("#importTranscript").value.trim(); if(!transcript) return alert("전사 내용 또는 전사 파일이 필요합니다.");
  const m=await api("/api/meetings",{method:"POST",body:JSON.stringify({title:$("#importTitle").value.trim(),recorded_at:$("#importDate").value||null,transcript,summary:$("#importSummary").value.trim()||null,source:"manual"})});
  importDialog.close(); await loadMeetings(); await openMeeting(m.id,"ko");
});

$("#editBtn").onclick=async()=>{
  if(!currentMeetingId) return; const m=await api(`/api/meetings/${currentMeetingId}?lang=ko`);
  $("#editTitle").value=m.title||""; $("#editDate").value=toLocalInput(m.recorded_at); $("#editSummary").value=m.summary||""; $("#editTranscript").value=m.transcript||""; editDialog.showModal();
};
$("#closeEdit").onclick=()=>editDialog.close(); $("#cancelEdit").onclick=()=>editDialog.close();
$("#editForm").addEventListener("submit",async(e)=>{
  e.preventDefault();
  const m=await api(`/api/meetings/${currentMeetingId}`,{method:"PUT",body:JSON.stringify({title:$("#editTitle").value.trim(),recorded_at:$("#editDate").value||null,summary:$("#editSummary").value.trim()||null,transcript:$("#editTranscript").value,participants:currentMeeting?.participants||null})});
  editDialog.close(); await openMeeting(m.id,"ko");
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

$("#logoutBtn").onclick=async()=>{ await fetch(apiUrl("/api/auth/logout"),{method:"POST",credentials:"include"}); location.replace("/login.html"); };

(async function boot(){
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
  await loadMeetings();
})();
