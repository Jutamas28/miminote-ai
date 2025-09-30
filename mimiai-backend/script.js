// script.js — คง UI เดิมทุกพิกเซล แก้เฉพาะ logic ให้เสถียรขึ้น
document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);
  const renderMD = (md)=>{ try{return marked.parse(md||'');}catch{return md||'';} };

  /* ---------- ค่าคงที่ ---------- */
  const MAX_SIZE = 120 * 1024 * 1024;   // 120MB

  /* ---------- Auth ---------- */
  let authToken = localStorage.getItem('token')||'';
  let isLogin = true;

  function safeEl(id){ const el=$(id); if(!el){ console.warn('missing element #'+id); } return el; }

  function swapAuthMode(){
    const title = safeEl('form-title');
    const toggleText = safeEl('toggle-text');
    if (!title || !toggleText) return; // กัน DOM ขาด
    title.textContent = isLogin ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก';
    toggleText.innerHTML = isLogin
      ? `ยังไม่มีบัญชี? <a href="#" id="toggle-link" class="text-pink-600">สมัครสมาชิก</a>`
      : `มีบัญชีแล้ว? <a href="#" id="toggle-link" class="text-pink-600">เข้าสู่ระบบ</a>`;
    // NOTE: ต้อง bind ใหม่ทุกครั้งหลังเปลี่ยน innerHTML
    const link = toggleText.querySelector('#toggle-link'); /* FIX: query จากตัว toggleText ตรง ๆ ลดโอกาสพลาด */
    if (link) link.addEventListener('click', (e)=>{e.preventDefault(); isLogin=!isLogin; swapAuthMode();});
  }
  swapAuthMode();

  async function doLogin(username,password){
    const r = await fetch('/api/auth/login',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username,password})
    });
    if(!r.ok){
      let msg='login failed';
      try{ const j=await r.json(); msg=j?.error||j?.message||msg; }catch{}
      throw new Error(msg);
    }
    const data=await r.json();
    authToken=data.token;
    localStorage.setItem('token',authToken);
    localStorage.setItem('currentUser',data.user.username);

    const wn = $('welcomeName'); if (wn) wn.textContent = data.user.username;

    $('authPage')?.classList.add('hidden');
    $('appPage')?.classList.remove('hidden');
    await loadProfile();  // จะตั้งชื่อเป็น full_name ให้เองถ้ามี
    loadLogs(); loadJobs();
  }
  async function doSignup(username,password){
    const r = await fetch('/api/auth/signup',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username,password})
    });
    if(!r.ok){
      let msg='signup failed';
      try{ const j=await r.json(); msg=j?.error||j?.message||msg; }catch{}
      throw new Error(msg);
    }
    alert('สมัครสมาชิกสำเร็จ! กรุณาเข้าสู่ระบบ');
    isLogin=true; swapAuthMode(); $('auth-form')?.reset();
  }
  $('auth-form')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const u=$('username')?.value.trim(), p=$('password')?.value.trim();
    if(!u||!p) return;
    try{ if(isLogin) await doLogin(u,p); else await doSignup(u,p); }
    catch(err){ alert('ดำเนินการไม่สำเร็จ: ' + (err?.message||err)); }
  });

  $('forgot-link')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const username = prompt('พิมพ์ชื่อผู้ใช้ที่ต้องการรีเซ็ตรหัสผ่าน:');
    if (!username) return;

    try {
      const r = await fetch('/api/auth/forgot', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ username })
      });
      let data = {};
      try { data = await r.json(); } catch {}
      if (!r.ok) throw new Error(data?.error || 'forgot failed');

      const code = data?.code || prompt('โค้ด 6 หลักที่ได้รับ (หรือดูใน server log):');
      if (!code) return;

      const newpass = prompt('ตั้งรหัสผ่านใหม่:');
      if (!newpass) return;

      const r2 = await fetch('/api/auth/reset', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ username, code, new_password: newpass })
      });
      let d2 = {};
      try { d2 = await r2.json(); } catch {}
      if (!r2.ok) throw new Error(d2?.error || 'reset failed');

      alert('รีเซ็ตรหัสผ่านสำเร็จ! ลองเข้าสู่ระบบอีกครั้ง');
    } catch (err) {
      alert('รีเซ็ตไม่สำเร็จ: ' + (err?.message || err));
    }
  });

  $('logoutIconBtn')?.addEventListener('click', ()=>{
    authToken=''; localStorage.removeItem('token'); localStorage.removeItem('currentUser');
    $('appPage')?.classList.add('hidden'); $('authPage')?.classList.remove('hidden');
  });

  /* ---------- Sidebar routing ---------- */
  const pages={ upload:$('pageUpload'), history:$('pageHistory'), feedback:$('pageFeedback'), account:$('pageAccount') };
  const navs ={ upload:$('navUpload'),  history:$('navHistory'),  feedback:$('navFeedback'),  account:$('navAccount') };
  function setPage(which){
    Object.values(pages).forEach(p=>p?.classList.add('hidden'));
    Object.values(navs).forEach(n=>n?.classList.remove('active'));
    pages[which]?.classList.remove('hidden');
    navs[which]?.classList?.add?.('active'); /* FIX: ป้องกันกรณี nav ไม่มีรายการนั้น */
    const hero = document.getElementById('heroSection');
  if (hero) {
    hero.classList.toggle('hidden', which !== 'upload');
  }
    if(which==='history') loadJobs();
    if(which==='feedback') loadLogs(true);
    if(which==='account') loadProfile(true);
    if(which==='status') loadStatus?.();
  }
  $('navUpload')?.addEventListener('click',(e)=>{e.preventDefault();setPage('upload');});
  $('navHistory')?.addEventListener('click',(e)=>{e.preventDefault();setPage('history');});
  $('navFeedback')?.addEventListener('click',(e)=>{e.preventDefault();setPage('feedback');});
  $('navAccount')?.addEventListener('click',(e)=>{e.preventDefault();setPage('account');});

  /* ---------- Upload & Tabs ---------- */
  const fileInput=$('fileInput'), dropzone=$('dropzone'), fileNameEl=$('fileName'), audioPlayer=$('audioPlayer');
  const downloadTxt=$('downloadTxt'), downloadPdf=$('downloadPdf'), downloadDocx=$('downloadDocx');
  const tabSummary=$('tabSummary'), tabTranscript=$('tabTranscript');
  const panelSummary=$('panelSummary'), panelTranscript=$('panelTranscript');
  const summaryPreview=$('summaryPreview'), transcriptPreview=$('transcriptPreview');
  const loadingEl=$('loading');

  let lastJobId=null, lastSummary='', lastTranscript='';

  function showTab(which){
    [tabSummary,tabTranscript].forEach(b=>{
      b?.classList.remove('border-b-2','border-pink-400','font-semibold','text-gray-900');
      b?.classList.add('text-gray-600');
    });
    if(which==='sum'){ tabSummary?.classList.add('border-b-2','border-pink-400','font-semibold','text-gray-900'); }
    if(which==='tra'){ tabTranscript?.classList.add('border-b-2','border-pink-400','font-semibold','text-gray-900'); }
    panelSummary?.classList.toggle('hidden', which!=='sum');
    panelTranscript?.classList.toggle('hidden', which!=='tra');
  }
  tabSummary?.addEventListener('click',()=>showTab('sum'));
  tabTranscript?.addEventListener('click',()=>showTab('tra'));
  showTab('sum');

  if(dropzone){
    dropzone.addEventListener('click', ()=>fileInput?.click());
    fileInput?.addEventListener('change',(e)=>{
      const f=e.target.files&&e.target.files[0];
      if (fileNameEl) fileNameEl.textContent = f ? 'ไฟล์: '+f.name : '';
      if(f && audioPlayer){ audioPlayer.src = URL.createObjectURL(f); }
    });
    $('clearBtn')?.addEventListener('click', ()=>{
      if (fileInput) fileInput.value='';
      if (fileNameEl) fileNameEl.textContent='';
      audioPlayer?.removeAttribute('src');
      if (summaryPreview) summaryPreview.innerHTML='';
      if (transcriptPreview) transcriptPreview.textContent='';
      downloadTxt?.removeAttribute('href'); downloadPdf?.removeAttribute('href'); downloadDocx?.removeAttribute('href');
    });
  }

  function setProgress(p){
    const bar=$('progressBar'), lbl=$('progressLabel');
    if(!bar||!lbl) return;
    const pct=Math.max(0,Math.min(100,p));
    bar.style.width=pct+'%'; lbl.textContent=Math.round(pct)+'%';
  }
  function showProgress(){ $('progressWrap')?.classList.remove('hidden'); }
  function hideProgress(){ $('progressWrap')?.classList.add('hidden'); }

  $('mockBtn')?.addEventListener('click', (e)=>{
    e.preventDefault();
    const file=fileInput?.files && fileInput.files[0];
    if(!file){ alert('กรุณาเลือกไฟล์เสียง/วิดีโอก่อน'); return; }

    if(file.size > MAX_SIZE){
      alert(`ไฟล์ใหญ่เกิน ${Math.round(MAX_SIZE/1024/1024)}MB`);
      return;
    }

    loadingEl?.classList.remove('hidden');
    if (summaryPreview) summaryPreview.innerHTML='';
    if (transcriptPreview) transcriptPreview.textContent='';
    showProgress(); setProgress(0);

    const form = new FormData();
    form.append('audio', file, file.name);   // ✅ ให้ตรงกับฝั่ง server
    form.append('language', 'auto');         // ให้ server auto-detect

    const xhr=new XMLHttpRequest();
    xhr.open('POST','/api/process',true);
    if(authToken) xhr.setRequestHeader('Authorization','Bearer '+authToken);

    xhr.upload.onprogress=(ev)=>{ if(ev.lengthComputable){ setProgress((ev.loaded/ev.total)*50); } };
    let tick=setInterval(()=>{
      const bar=$('progressBar');
      const now=bar?parseFloat(bar.style.width)||50:50;
      if(now<90) setProgress(now+1);
    },300);

    xhr.onreadystatechange=()=>{
      if(xhr.readyState===XMLHttpRequest.DONE){
        clearInterval(tick); loadingEl?.classList.add('hidden');
        try{
          if(xhr.status === 413){
            setProgress(100); setTimeout(hideProgress,800);
            throw new Error('ไฟล์ใหญ่กว่าลิมิตฝั่งเซิร์ฟเวอร์ (120MB) หรือถูก Proxy ตัดไว้');
          }
          if (xhr.status === 0) { // NETWORK/CORS/timeout
            throw new Error('NETWORK/CORS ERROR');
          }

          let data={};
          try{ data = JSON.parse(xhr.responseText||'{}'); }catch{}
          if(xhr.status<200||xhr.status>=300){
            const msg = data?.message || data?.detail || data?.error || `HTTP ${xhr.status}`;
            throw new Error(msg);
          }

          lastJobId      = data.jobId || null;
          lastTranscript = data.transcription || data.text || '';
          lastSummary    = data.summary || lastTranscript || '';

          if (summaryPreview) summaryPreview.innerHTML   = renderMD(lastSummary);
          if (transcriptPreview) transcriptPreview.textContent = lastTranscript || '';

          if(lastJobId){
            if (downloadTxt)  downloadTxt.href  = `/api/export/${lastJobId}?format=txt`;
            if (downloadPdf)  downloadPdf.href  = `/api/export/${lastJobId}?format=pdf`;
            if (downloadDocx) downloadDocx.href = `/api/export/${lastJobId}?format=docx`;
          }else{
            // ไม่มี jobId ก็เคลียร์ลิงก์กันพลาด
            downloadTxt?.removeAttribute('href');
            downloadPdf?.removeAttribute('href');
            downloadDocx?.removeAttribute('href');
          }

          setProgress(100); setTimeout(hideProgress,600); showTab('sum');
        }catch(err){
          console.error(err);
          alert('เกิดข้อผิดพลาด: '+(err.message||err));
          setProgress(100); setTimeout(hideProgress,1000);
        }
      }
    };
    xhr.onerror=()=>{
      loadingEl?.classList.add('hidden');
      setProgress(100);
      alert('เกิดข้อผิดพลาดในการเชื่อมต่อ');
      setTimeout(hideProgress,1000);
    };
    xhr.timeout = 15 * 60 * 1000; // 15 นาที
    xhr.ontimeout = () => {
      loadingEl?.classList.add('hidden');
      setProgress(100); setTimeout(hideProgress, 800);
      alert('แปลงเสียงใช้เวลานานเกินกำหนด (15 นาที) — ลองอัปไฟล์สั้นลงหรือแปลงใหม่'); /* FIX: ตรงกับค่า timeout จริง */
    };

    xhr.send(form);
  });

  /* ---------- Feedback (paged) ---------- */
  const FEED_LIMIT = 10;
  let feedOffset = 0;
  let loadMoreBtn = null;

  async function renderCommentsChunk(reset=false){
    const feedList = $('feedList'); if (!feedList) return;

    if (!loadMoreBtn) {
      loadMoreBtn = document.createElement('button');
      loadMoreBtn.id = 'loadMoreFeed';
      loadMoreBtn.className = 'btn btn-pink mt-3';
      loadMoreBtn.textContent = 'ดูเพิ่มเติม';
      loadMoreBtn.style.display = 'none';
      feedList.parentElement?.appendChild(loadMoreBtn); /* FIX: กันกรณีไม่มี parentElement */
      loadMoreBtn.addEventListener('click', ()=> loadLogs(false));
    }

    if (reset) {
      feedList.innerHTML = '';
      feedOffset = 0;
      loadMoreBtn.style.display = 'none';
    }

    try{
      const r = await fetch(`/api/comments?offset=${feedOffset}&limit=${FEED_LIMIT}`);
      let data = {};
      try{ data = await r.json(); }catch{}
      const rows = data?.comments || [];

      if (!rows.length && feedOffset === 0) {
        feedList.innerHTML = `<div class="text-gray-500">ยังไม่มีรีวิว</div>`;
        loadMoreBtn.style.display = 'none';
        return;
      }

      rows.forEach(c=>{
        const div=document.createElement('div');
        div.className="p-3 bg-pink-50 rounded-lg border";
        div.innerHTML =
          `<div class="text-xs text-gray-600">${(c.username||'ผู้ใช้')} • ${new Date(c.created_at).toLocaleString()} • <span class="pill">${c.filename||'-'}</span></div>
           <div class="mt-1">${c.content}</div>`;
        feedList.appendChild(div);
      });

      feedOffset = data?.next_offset ?? (feedOffset + rows.length);
      loadMoreBtn.style.display = data?.has_more ? 'inline-block' : 'none';
    }catch(e){
      if (feedOffset === 0) {
        feedList.innerHTML = `<div class="text-red-600 text-sm">โหลดไม่สำเร็จ</div>`;
      }
      loadMoreBtn.style.display = 'none';
    }
  }

  async function loadLogs(reset=true){
    await renderCommentsChunk(reset);
  }
  $('refreshFeed')?.addEventListener('click', ()=> loadLogs(true));

  /* ---------- History ---------- */
  const jobsTable=$('jobsTable'), jobsEmpty=$('jobsEmpty'), btnReloadJobs=$('btnReloadJobs');
  const jobDrawer=$('jobDrawer'), jobMeta=$('jobMeta'), closeDrawer=$('closeDrawer');
  const drawerSummary=$('drawerSummary'), drawerTranscript=$('drawerTranscript');
  const commentsList=$('commentsList'), commentInput=$('commentInput'), commentSend=$('commentSend');
  const dlTxt=$('dlTxt'), dlPdf=$('dlPdf'), dlDocx=$('dlDocx');
  let currentJobId=null;

  async function loadJobs(){
    if(!jobsTable) return;
    jobsTable.innerHTML=''; jobsEmpty?.classList.add('hidden');
    try{
      const r=await fetch('/api/jobs',{ headers: authToken?{'Authorization':'Bearer '+authToken}:{} });
      let data={}; try{ data=await r.json(); }catch{}
      const rows=data?.jobs||[];
      if(rows.length===0){ jobsEmpty?.classList.remove('hidden'); return; }
      rows.forEach(j=>{
        const tr=document.createElement('tr'); tr.className='border-b';
        tr.innerHTML=`<td class="py-2 pr-4">${j.filename||'-'}</td>
                      <td class="py-2 pr-4"><span class="pill">${j.status}</span></td>
                      <td class="py-2 pr-4">${new Date(j.created_at).toLocaleString()}</td>
                      <td class="py-2 pr-4"><button class="btn btn-yellow text-sm" data-id="${j.id}">เปิด</button></td>`;
        jobsTable.appendChild(tr);
      });
      jobsTable.querySelectorAll('button[data-id]')?.forEach(b=> b.onclick=()=>openJob(b.getAttribute('data-id')));
    }catch(e){ console.error(e); }
  }
  btnReloadJobs?.addEventListener('click', loadJobs);
  closeDrawer?.addEventListener('click', ()=>jobDrawer?.classList.add('hidden'));

  async function openJob(id){
    currentJobId=id; jobDrawer?.classList.remove('hidden');
    const r=await fetch(`/api/jobs/${id}`,{ headers: authToken?{'Authorization':'Bearer '+authToken}:{} });
    let row={}; try{ row=await r.json(); }catch{}
    if (jobMeta) jobMeta.textContent=`ID: ${row.id} • ไฟล์: ${row.filename} • วันที่: ${new Date(row.created_at).toLocaleString()}`;
    if (drawerTranscript) drawerTranscript.textContent = row.transcript || '';
    if (drawerSummary)    drawerSummary.innerHTML      = renderMD(row.summary||'');
    if (dlTxt)  dlTxt.href  = `/api/export/${id}?format=txt`;
    if (dlPdf)  dlPdf.href  = `/api/export/${id}?format=pdf`;
    if (dlDocx) dlDocx.href = `/api/export/${id}?format=docx`;
    await loadComments(id);
  }
  async function loadComments(id){
    if (!commentsList) return;
    commentsList.innerHTML='';
    const r=await fetch(`/api/jobs/${id}/comments`,{ headers: authToken?{'Authorization':'Bearer '+authToken}:{} });
    let data={}; try{ data=await r.json(); }catch{}
    (data?.comments||[]).forEach(c=>{
      const div=document.createElement('div'); div.className='p-3 bg-pink-50 rounded-lg';
      const name = (c.username && c.username.trim()) ? c.username : "ผู้ใช้";
      div.innerHTML=`<div class="text-xs text-gray-600">${name} • ${new Date(c.created_at).toLocaleString()}</div><div>${c.content}</div>`;
      commentsList.appendChild(div);
    });
  }
  commentSend?.addEventListener('click', async()=>{
    if(!currentJobId) return;
    const content=(commentInput?.value||'').trim(); if(!content) return;
    const show = confirm('แสดงชื่อผู้ใช้ในคอมเมนต์นี้หรือไม่?');
    await fetch(`/api/jobs/${currentJobId}/comments`,{
      method:'POST',
      headers:{'Content-Type':'application/json', ...(authToken?{'Authorization':'Bearer '+authToken}:{})},
      body:JSON.stringify({content, show_name:show})
    });
    if (commentInput) commentInput.value='';
    await loadComments(currentJobId);
  });

  /* ---------- Profile ---------- */
  const accAvatar=$('accAvatar'), accAvatarPreview=$('accAvatarPreview'), accPickImage=$('accPickImage');
  const accFullName=$('accFullName'), accBirthday=$('accBirthday');
  const accSaveProfile=$('accSaveProfile'), accMsg=$('accMsg');
  const accUsername=$('accUsername'), accNewPass=$('accNewPass'), accChangePass=$('accChangePass'), accPwMsg=$('accPwMsg');

  accPickImage?.addEventListener('click', ()=> accAvatar?.click());

  // ✅ แก้จุดนี้: อัปโหลด Avatar ต้องส่งฟิลด์ชื่อ 'avatar' ไป /api/settings/profile/avatar
  accAvatar?.addEventListener('change', async ()=>{
    const f = accAvatar.files?.[0]; if(!f) return;
    if (accAvatarPreview) accAvatarPreview.src = URL.createObjectURL(f);
    if(!localStorage.getItem('token')) { alert('กรุณาเข้าสู่ระบบ'); return; }

    try{
      const fd = new FormData();
      fd.append('avatar', f, f.name); // ใช้ชื่อฟิลด์ให้ตรงกับ server (multer)

      const r = await fetch('/api/settings/profile/avatar', {
        method:'POST',
        headers:{ 'Authorization':'Bearer '+localStorage.getItem('token') },
        body: fd
      });
      let data={}; try{ data=await r.json(); }catch{}
      if(!r.ok || !data?.avatar_url){
        const msg = data?.message || data?.detail || data?.error || 'อัปโหลดรูปไม่สำเร็จ';
        throw new Error(msg);
      }
      if (accAvatarPreview) accAvatarPreview.src = data.avatar_url;
    }catch(e){
      console.error(e);
      alert('อัปโหลดรูปไม่สำเร็จ: ' + (e.message || e));
    }
  });

  async function loadProfile(fill=false){
    try{
      const hdr=authToken?{'Authorization':'Bearer '+authToken}:{};
      const r=await fetch('/api/settings/profile',{headers:hdr});
      let p={}; try{ p=await r.json(); }catch{}

      const nameFromProfile = (p?.full_name && p.full_name.trim()) || '';
      const fallbackUser    = localStorage.getItem('currentUser') || '';
      const finalName       = nameFromProfile || fallbackUser || 'ผู้ใช้';
      const wn = $('welcomeName'); if (wn) wn.textContent = finalName;

      if(p?.avatar_url && accAvatarPreview) accAvatarPreview.src=p.avatar_url;
      if(fill){
        if(accFullName) accFullName.value=p?.full_name||'';
        if(accBirthday) accBirthday.value=p?.birthday||'';
      }
    }catch{}
  }

  // บันทึกโปรไฟล์ + รีเฟรชชื่อ/คอมเมนต์/ฟีดทันที
  accSaveProfile?.addEventListener('click', async () => {
    if (!authToken) {
      alert('กรุณาเข้าสู่ระบบ');
      return;
    }

    const full = (accFullName?.value || '').trim();
    const body = { full_name: full, birthday: accBirthday?.value || '' };

    try {
      const rr = await fetch('/api/settings/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + authToken
        },
        body: JSON.stringify(body)
      });

      let saved={}; try{ saved=await rr.json(); }catch{}
      if (!rr.ok) {
        const msg = saved?.message || saved?.detail || saved?.error || 'profile update failed';
        throw new Error(msg);
      }

      const wn = $('welcomeName');
      if (wn) wn.textContent = full || localStorage.getItem('currentUser') || 'ผู้ใช้';

      accMsg?.classList.remove('hidden');
      setTimeout(() => accMsg?.classList.add('hidden'), 1500);

      await loadProfile(true);
      if (typeof currentJobId === 'string' && currentJobId) {
        await loadComments(currentJobId);
      }
      await loadLogs();
    } catch (e) {
      console.error(e);
      alert('บันทึกโปรไฟล์ไม่สำเร็จ: ' + (e.message || e));
    }
  });

  accChangePass?.addEventListener('click', ()=>{
    const u=(accUsername?.value||'').trim(), p=(accNewPass?.value||'').trim();
    if(!u||!p){ alert('กรอกชื่อผู้ใช้และรหัสผ่านใหม่'); return; }
    let users=JSON.parse(localStorage.getItem('users')||'{}'); users[u]=p; localStorage.setItem('users', JSON.stringify(users));
    if (accNewPass) accNewPass.value='';
    accPwMsg?.classList.remove('hidden'); setTimeout(()=>accPwMsg?.classList.add('hidden'),1500);
  });

  /* ---------- Status Page ---------- */
  const pageStatus = $('pageStatus'), navStatus = $('navStatus'), statusBox = $('statusBox'), btnRefreshStatus = $('btnRefreshStatus');

  navStatus?.addEventListener('click', (e) => { e.preventDefault(); setPage('status'); });

  pages.status = pageStatus; // ผูกเข้า router เดิม
  // (ไม่เพิ่มใน navs เพื่อคง UI เดิมไม่เปลี่ยน class active ของเมนู)

  async function loadStatus() {
    if (!statusBox) return;
    statusBox.textContent = 'กำลังตรวจสอบ...';
    try {
      const r = await fetch('/api/status');
      let data={}; try{ data=await r.json(); }catch{}
      statusBox.textContent = JSON.stringify(data, null, 2);
    } catch (e) {
      statusBox.textContent = 'โหลดไม่สำเร็จ: ' + (e?.message || e);
    }
  }
  btnRefreshStatus?.addEventListener('click', loadStatus);

  // ===== Helpers (วางไว้ใกล้ loadStatus ได้) =====
function secToHMS(s){
  const sec = Math.max(0, Number(s)||0);
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), ss = sec%60;
  return `${h}h ${m}m ${ss}s`;
}
function msToFancy(ms){
  const m = Math.round((Number(ms)||0)/1000/60);
  return m ? `${m} นาที` : `${Math.round((Number(ms)||0)/1000)} วินาที`;
}
function setDot(el, ok){ el?.classList.remove('ok','fail'); el?.classList.add(ok?'ok':'fail'); }
function setBadge(ok){ const b=document.getElementById('statusBadge'); if(!b) return;
  b.classList.remove('ok','fail'); b.classList.add(ok?'ok':'fail');
  b.textContent = ok ? 'พร้อมใช้งาน (All good)' : 'มีปัญหาบางส่วน (Check below)';
}

let statusAutoTimer = null;

// ===== Render + Load =====
async function loadStatus(){
  const raw = document.getElementById('statusBox');
  const tEl = document.getElementById('statusTime');
  try{
    raw.textContent = 'กำลังดึงข้อมูล…';
    const r = await fetch('/api/status');
    const data = await r.json();

    // เวลาอัปเดต
    if (tEl) tEl.textContent = new Date().toLocaleString();

    // สรุป badge
    setBadge(!!data.ok);

    // OpenAI
    const openaiOk = !!data?.checks?.openai_api?.ok;
    setDot(document.getElementById('openaiDot'), openaiOk);
    const oStatus = document.getElementById('openaiStatus');
    const oSample = document.getElementById('openaiSample');
    if (oStatus) oStatus.textContent = openaiOk ? 'OK' : 'ERROR';
    if (oSample) {
      const sample = data?.checks?.openai_api?.sample || data?.checks?.openai_api?.error || '—';
      oSample.textContent = sample;
      oSample.title = sample;
    }

    // FFmpeg
    const ffOk = !!data?.checks?.ffmpeg?.ok;
    setDot(document.getElementById('ffmpegDot'), ffOk);
    const ffv = document.getElementById('ffmpegVersion');
    const ffp = document.getElementById('ffmpegPath');
    if (ffv) ffv.textContent = ffOk ? (data?.checks?.ffmpeg?.version || '—') : (data?.checks?.ffmpeg?.error || 'ERROR');
    if (ffp) { const p = data?.checks?.ffmpeg?.path || '-'; ffp.textContent = p; ffp.title = p; }

    // FFprobe
    const fpOk = !!data?.checks?.ffprobe?.ok;
    setDot(document.getElementById('ffprobeDot'), fpOk);
    const fpv = document.getElementById('ffprobeVersion');
    const fpp = document.getElementById('ffprobePath');
    if (fpv) fpv.textContent = fpOk ? (data?.checks?.ffprobe?.version || '—') : (data?.checks?.ffprobe?.error || 'ERROR');
    if (fpp) { const p = data?.checks?.ffprobe?.path || '-'; fpp.textContent = p; fpp.title = p; }

    // Limits
    const L = data?.checks?.limits || {};
    const list = document.getElementById('limitsList');
    if (list) {
      list.innerHTML = `
        <li>Upload: ${L.upload_limit_mb ? `${L.upload_limit_mb} MB` : '—'}</li>
        <li>Transcribe timeout: ${L.transcribe_timeout_ms ? msToFancy(L.transcribe_timeout_ms) : '—'}</li>
        <li>Process timeout: ${L.process_timeout_ms ? msToFancy(L.process_timeout_ms) : '—'}</li>
        <li>Summarize timeout: ${L.summarize_timeout_ms ? msToFancy(L.summarize_timeout_ms) : '—'}</li>
      `;
    }

    // Uptime + Disk
    const up = document.getElementById('uptimeValue');
    if (up) up.textContent = secToHMS(data?.checks?.uptime?.seconds);
    const db = document.getElementById('diskBase');
    const ds = document.getElementById('diskStatus');
    if (db) { const p = data?.checks?.disk_usage?.basePath || '-'; db.textContent=p; db.title=p; }
    if (ds) ds.textContent = data?.checks?.disk_usage?.ok ? 'พร้อมใช้งาน' : 'มีปัญหา';

    // Raw JSON
    raw.textContent = JSON.stringify(data, null, 2);
  }catch(e){
    setBadge(false);
    if (tEl) tEl.textContent = 'โหลดไม่สำเร็จ';
    const raw = document.getElementById('statusBox');
    if (raw) raw.textContent = 'โหลดไม่สำเร็จ: ' + (e?.message || e);
  }
}

// ปุ่มกด & Auto-refresh
document.getElementById('btnRefreshStatus')?.addEventListener('click', loadStatus);
document.getElementById('btnCopyJSON')?.addEventListener('click', async ()=>{
  const raw = document.getElementById('statusBox');
  try{
    await navigator.clipboard.writeText(raw?.textContent || '');
    alert('คัดลอก JSON แล้ว');
  }catch{ alert('คัดลอกไม่สำเร็จ'); }
});
document.getElementById('autoRefresh')?.addEventListener('change', (e)=>{
  const on = e.target.checked;
  if (statusAutoTimer) { clearInterval(statusAutoTimer); statusAutoTimer = null; }
  if (on) statusAutoTimer = setInterval(loadStatus, 15000);
});

// เรียกครั้งแรกเมื่อเข้าหน้านี้ (คุณมี router setPage('status') เรียก loadStatus แล้วอยู่)


  /* ---------- Init ---------- */
  (async function init(){
    if(authToken){
      $('authPage')?.classList.add('hidden'); $('appPage')?.classList.remove('hidden');

      const wn = $('welcomeName'); if (wn) wn.textContent = localStorage.getItem('currentUser') || 'ผู้ใช้';

      await loadProfile(true);
      loadJobs();
    }
    setPage('upload');
  })();
});
