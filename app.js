(function () {
  "use strict";
  const CFG = window.APP_CONFIG || {};
  const DEMO = !CFG.SUPABASE_URL || CFG.SUPABASE_URL.indexOf("YOUR_PROJECT") !== -1;
  const CC = CFG.DEFAULT_COUNTRY_CODE || "20";
  const MSG = CFG.DEFAULT_MESSAGE || "السلام عليكم ورحمة الله وبركاته";

  const STATUS_LABEL = { new:"جديد", claimed:"محجوز", sent:"اتبعت", replied:"ردّ", no_answer:"مفيش رد" };
  const SENT_STATES = ["sent","replied"]; // تعتبر "اتبعت" فعليًا

  let sb = null, user = null;
  let contacts = [], categories = [];
  let parsedRows = null;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;","'":"&#39;"}[c]));
  function toast(m){ const t=$("toast"); t.textContent=m; t.classList.remove("hidden"); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.add("hidden"),2600); }

  function normalizePhone(raw){
    if(!raw) return null;
    // تحويل float قادم من Excel (مثل 966501234567.0) لـ string نظيف
    let s = String(raw).trim().replace(/\.0+$/, "").replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0)-0x0660));
    const plus = s.trim().startsWith("+");
    s = s.replace(/\D/g, "");
    if(!s) return null;
    if(s.startsWith("00")) s = s.slice(2);
    if(plus) return s;
    if(s.startsWith(CC)) return s;
    if(s.startsWith("0")) return CC + s.replace(/^0+/, "");
    return CC + s;
  }
  function renderLocation(loc){
    if(!loc) return "—";
    if(/^https?:\/\//i.test(loc))
      return `<a href="${esc(loc)}" target="_blank" rel="noopener" class="loc-link">🔗 فتح</a>`;
    return esc(loc);
  }
  function waLink(phone){
    const mode = localStorage.getItem("wa_mode") || "wa.me";
    const text = encodeURIComponent(MSG);
    
    // فحص نظام التشغيل لتحديد الروابط المباشرة (Deep Links)
    const ua = navigator.userAgent.toLowerCase();
    const isAndroid = ua.indexOf("android") > -1;
    const isIOS = /ipad|iphone|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (mode === "web") {
      return `https://web.whatsapp.com/send?phone=${phone}&text=${text}`;
    }

    if (mode === "personal") {
      if (isAndroid) {
        // إجبار فتح تطبيق الواتساب العادي على أندرويد
        return `intent://send?phone=${phone}&text=${text}#Intent;package=com.whatsapp;scheme=whatsapp;end`;
      } else if (isIOS) {
        // إجبار فتح تطبيق الواتساب العادي على آيفون
        return `whatsapp-consumer://send?phone=${phone}&text=${text}`;
      } else {
        // على الكمبيوتر: يفتح صفحة التحويل لتطبيق الواتساب المثبت
        return `https://api.whatsapp.com/send?phone=${phone}&text=${text}`;
      }
    }

    if (mode === "business") {
      if (isAndroid) {
        // إجبار فتح تطبيق واتساب الأعمال على أندرويد
        return `intent://send?phone=${phone}&text=${text}#Intent;package=com.whatsapp.w4b;scheme=whatsapp;end`;
      } else if (isIOS) {
        // إجبار فتح تطبيق واتساب الأعمال على آيفون
        return `whatsapp://send?phone=${phone}&text=${text}`;
      } else {
        // على الكمبيوتر: يفتح الرابط الافتراضي للتحويل للنشط
        return `https://api.whatsapp.com/send?phone=${phone}&text=${text}`;
      }
    }

    if (mode === "gbwhatsapp") {
      if (isAndroid) {
        // فتح تطبيق جي بي واتساب على أندرويد
        return `intent://send?phone=${phone}&text=${text}#Intent;package=com.gbwhatsapp;scheme=whatsapp;end`;
      } else {
        return `whatsapp://send?phone=${phone}&text=${text}`;
      }
    }

    if (mode === "fmwhatsapp") {
      if (isAndroid) {
        // فتح تطبيق واتساب إف إم على أندرويد
        return `intent://send?phone=${phone}&text=${text}#Intent;package=com.fmwhatsapp;scheme=whatsapp;end`;
      } else {
        return `whatsapp://send?phone=${phone}&text=${text}`;
      }
    }

    if (mode === "whatsapp_scheme") {
      // إطلاق رابط بروتوكول واتساب المباشر (يطلب من النظام الاختيار إذا لم يكن هناك افتراضي)
      return `whatsapp://send?phone=${phone}&text=${text}`;
    }

    // الوضع الافتراضي (تلقائي): wa.me
    return `https://wa.me/${phone}?text=${text}`;
  }
  const sentByOf = (c) => c.sent_by_email || null;

  // ============================================================
  // طبقة البيانات
  // ============================================================
  const api = {
    async signIn(email, password){
      if(DEMO){ user = { email: "demo@ojlinker.com", id:"demo" }; return; }
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if(error) throw error;
      const { data } = await sb.auth.getUser(); user = data.user;
    },
    async signOut(){ if(DEMO){ location.reload(); return; } await sb.auth.signOut(); location.reload(); },
    async loadCategories(){
      if(DEMO){ categories = ["صالون","عيادة","فندق"]; return; }
      const { data, error } = await sb.from("categories").select("name").order("name");
      if(error) throw error; categories = (data||[]).map(r=>r.name);
    },
    async addCategory(name){
      if(DEMO){ if(!categories.includes(name)) categories.push(name); return; }
      await sb.from("categories").insert({ name }).select();
      if(!categories.includes(name)) categories.push(name);
    },
    async loadContacts(){
      if(DEMO){ contacts = DEMO_DATA.slice(); return; }
      const { data, error } = await sb.from("contacts").select("*").order("created_at",{ascending:false});
      if(error) throw error; contacts = data||[];
    },
    async claim(id){
      if(DEMO){ const c=contacts.find(x=>x.id===id); if(c&&c.status==="new"){c.status="claimed";c.claimed_by_email=user.email;} return c; }
      const { data, error } = await sb.rpc("claim_contact", { contact_id:id });
      if(error) throw error; return Array.isArray(data)?data[0]:data;
    },
    async setStatus(id, status){
      const patch = { status };
      if(status==="sent"){ patch.sent_by_email = user.email; patch.sent_at = new Date().toISOString(); }
      if(DEMO){ const c=contacts.find(x=>x.id===id); Object.assign(c,patch); return; }
      const { error } = await sb.from("contacts").update(patch).eq("id",id); if(error) throw error;
    },
    async upload(rows){
      if(DEMO){
        const existing = new Set(contacts.map(c=>c.phone)); let added=0;
        rows.forEach(r=>{ if(!existing.has(r.phone)){ contacts.unshift(Object.assign({id:"d"+Math.random(),status:"new"},r)); existing.add(r.phone); added++; } });
        return added;
      }
      const { data, error } = await sb.from("contacts").upsert(rows,{ onConflict:"phone", ignoreDuplicates:true }).select();
      if(error) throw error; return (data||[]).length;
    },
    subscribe(cb){
      if(DEMO) return;
      sb.channel("contacts-rt").on("postgres_changes",{ event:"*", schema:"public", table:"contacts" }, cb).subscribe();
    }
  };

  // ============================================================
  // صفحة جهات الاتصال
  // ============================================================
  function renderStats(){
    const by = s => contacts.filter(c=>c.status===s).length;
    $("stats").innerHTML = [
      ["total",contacts.length,"الإجمالي"],["new",by("new"),"جديد"],["claimed",by("claimed"),"محجوز"],
      ["sent",by("sent"),"اتبعت"],["replied",by("replied"),"ردّ"]
    ].map(([k,n,l])=>`<div class="stat ${k}"><div class="num">${n}</div><div class="lbl">${l}</div></div>`).join("");
  }

  function renderTable(){
    const cat=$("filterCategory").value, st=$("filterStatus").value, mem=$("filterMember").value,
          city=$("filterCity").value.trim().toLowerCase(), q=$("searchInput").value.trim().toLowerCase();
    const rows = contacts.filter(c=>{
      if(cat && c.category!==cat) return false;
      if(st && c.status!==st) return false;
      if(mem && sentByOf(c)!==mem) return false;
      if(city && (c.city||"").toLowerCase().indexOf(city)===-1) return false;
      if(q){ const hay=((c.name||"")+" "+(c.phone||"")).toLowerCase(); if(hay.indexOf(q)===-1) return false; }
      return true;
    });
    $("emptyState").classList.toggle("hidden", rows.length>0);
    // 1) Desktop rendering
    $("contactsBody").innerHTML = rows.map(c=>{
      const sentDisabled = c.status==="sent"||c.status==="replied";
      return `<tr data-id="${esc(c.id)}">
        <td class="name">${esc(c.name||"—")}</td>
        <td dir="ltr" class="small">${esc(c.phone)}</td>
        <td class="city-cell">${esc(c.city||"—")}</td>
        <td class="loc-cell">${renderLocation(c.location)}</td>
        <td><span class="pill pill-cat">${esc(c.category)}</span></td>
        <td><span class="pill st-${esc(c.status)}">${STATUS_LABEL[c.status]||c.status}</span></td>
        <td class="muted small">${esc((c.sent_by_email||c.claimed_by_email||"—").split("@")[0])}</td>
        <td class="actions-col"><div class="row-actions">
          <button class="btn btn-sm btn-wa" data-act="send">💬 واتساب</button>
          <button class="btn btn-sm" data-act="sent" ${sentDisabled?"disabled":""}>✓ اتبعت</button>
          <button class="btn btn-sm" data-act="reply">ردّ</button>
          <button class="btn btn-sm" data-act="no">✕</button>
        </div></td>
      </tr>`;
    }).join("");

    // 2) Mobile rendering (card design)
    $("contactsMobileList").innerHTML = rows.map(c=>{
      const sentDisabled = c.status==="sent"||c.status==="replied";
      return `
        <div class="contact-card" data-id="${esc(c.id)}">
          <div class="card-top">
            <strong class="card-name">${esc(c.name||"—")}</strong>
            <span class="pill st-${esc(c.status)}">${STATUS_LABEL[c.status]||c.status}</span>
          </div>
          <div class="card-mid">
            <span class="card-info">📞 ${esc(c.phone)}</span>
            <span class="card-info">🏙️ ${esc(c.city||"—")}</span>
            <span class="pill pill-cat">${esc(c.category)}</span>
            ${c.location ? `<span class="card-info-loc">${renderLocation(c.location)}</span>` : ""}
          </div>
          ${c.sent_by_email || c.claimed_by_email ? `
            <div class="card-assign">
              👤 المسؤول: <span class="assigned-user">${esc((c.sent_by_email||c.claimed_by_email||"").split("@")[0])}</span>
            </div>
          ` : ""}
          <div class="card-actions">
            <button class="btn btn-sm btn-wa" data-act="send">💬 واتساب</button>
            <button class="btn btn-sm" data-act="sent" ${sentDisabled?"disabled":""}>✓ اتبعت</button>
            <button class="btn btn-sm" data-act="reply">ردّ</button>
            <button class="btn btn-sm" data-act="no">✕</button>
          </div>
        </div>
      `;
    }).join("");
  }

  // ============================================================
  // صفحة التقارير (مين بعت لكام رقم ولكام تصنيف)
  // ============================================================
  function renderReports(){
    const catF=$("repCategory").value, cityF=$("repCity").value.trim().toLowerCase(), memF=$("repMember").value.trim().toLowerCase();
    const sent = contacts.filter(c=> SENT_STATES.indexOf(c.status)!==-1 && sentByOf(c) &&
      (!catF || c.category===catF) && (!cityF || (c.city||"").toLowerCase().indexOf(cityF)!==-1) && (!memF || sentByOf(c).toLowerCase().indexOf(memF)!==-1));

    const cats = catF ? [catF] : categories.slice();
    // تأكد إن أي تصنيف موجود في البيانات يظهر
    sent.forEach(c=>{ if(cats.indexOf(c.category)===-1) cats.push(c.category); });

    const map = {}; // member -> { total, byCat }
    sent.forEach(c=>{
      const m = sentByOf(c);
      if(!map[m]) map[m] = { total:0, byCat:{} };
      map[m].total++; map[m].byCat[c.category] = (map[m].byCat[c.category]||0)+1;
    });
    const members = Object.keys(map).sort((a,b)=>map[b].total-map[a].total);

    $("reportEmpty").classList.toggle("hidden", members.length>0);
    $("reportHead").innerHTML = `<tr><th>العضو</th><th class="num-cell">إجمالي المُرسل</th>${cats.map(c=>`<th class="num-cell">${esc(c)}</th>`).join("")}</tr>`;
    $("reportBody").innerHTML = members.map(m=>{
      const r = map[m];
      return `<tr><td class="name">${esc(m)}</td><td class="num-cell total-cell">${r.total}</td>${cats.map(c=>`<td class="num-cell">${r.byCat[c]||0}</td>`).join("")}</tr>`;
    }).join("");
    // صف الإجمالي
    if(members.length){
      const totalAll = sent.length;
      const perCat = cats.map(c=> sent.filter(x=>x.category===c).length);
      $("reportFoot").innerHTML = `<tr><td>الإجمالي</td><td class="num-cell">${totalAll}</td>${perCat.map(n=>`<td class="num-cell">${n}</td>`).join("")}</tr>`;
    } else { $("reportFoot").innerHTML=""; }
  }

  // ============================================================
  // صفحة المُرسَل
  // ============================================================
  function renderSentPage(){
    const cat=$("sentFilterCategory").value, mem=$("sentFilterMember").value,
          city=$("sentFilterCity").value.trim().toLowerCase(), q=$("sentSearch").value.trim().toLowerCase();
    const rows = contacts.filter(c=>{
      if(SENT_STATES.indexOf(c.status)===-1) return false;
      if(cat && c.category!==cat) return false;
      if(mem && sentByOf(c)!==mem) return false;
      if(city && (c.city||"").toLowerCase().indexOf(city)===-1) return false;
      if(q){ const hay=((c.name||"")+" "+(c.phone||"")).toLowerCase(); if(hay.indexOf(q)===-1) return false; }
      return true;
    });
    // 1) Desktop table
    $("sentBody").innerHTML = rows.map(c=>{
      const dateStr = c.sent_at ? new Date(c.sent_at).toLocaleDateString("ar-SA",{day:"2-digit",month:"2-digit",year:"numeric"}) : "—";
      return `<tr>
        <td class="name">${esc(c.name||"—")}</td>
        <td dir="ltr" class="small">${esc(c.phone)}</td>
        <td class="city-cell">${esc(c.city||"—")}</td>
        <td class="loc-cell">${renderLocation(c.location)}</td>
        <td><span class="pill pill-cat">${esc(c.category)}</span></td>
        <td><span class="pill st-${esc(c.status)}">${STATUS_LABEL[c.status]||c.status}</span></td>
        <td class="muted small">${esc((sentByOf(c)||"—").split("@")[0])}</td>
        <td class="muted small">${dateStr}</td>
      </tr>`;
    }).join("");

    // 2) Mobile cards
    $("sentMobileList").innerHTML = rows.map(c=>{
      const dateStr = c.sent_at ? new Date(c.sent_at).toLocaleDateString("ar-SA",{day:"2-digit",month:"2-digit",year:"numeric"}) : "—";
      return `
        <div class="contact-card">
          <div class="card-top">
            <strong class="card-name">${esc(c.name||"—")}</strong>
            <span class="pill st-${esc(c.status)}">${STATUS_LABEL[c.status]||c.status}</span>
          </div>
          <div class="card-mid">
            <span class="card-info">📞 ${esc(c.phone)}</span>
            <span class="card-info">🏙️ ${esc(c.city||"—")}</span>
            <span class="pill pill-cat">${esc(c.category)}</span>
            ${c.location ? `<span class="card-info-loc">${renderLocation(c.location)}</span>` : ""}
          </div>
          <div class="card-assign" style="display: flex; justify-content: space-between;">
            <span>👤 المسؤول: <span class="assigned-user">${esc((sentByOf(c)||"—").split("@")[0])}</span></span>
            <span class="muted text-xs">📅 ${dateStr}</span>
          </div>
        </div>
      `;
    }).join("");
  }

  // ============================================================
  // مشترك
  // ============================================================
  function memberList(){
    const set = new Set(); contacts.forEach(c=>{ if(sentByOf(c)) set.add(sentByOf(c)); });
    return Array.from(set).sort();
  }
  function fillCategorySelects(){
    const opts = categories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
    $("filterCategory").innerHTML = `<option value="">كل التصنيفات</option>` + opts;
    $("sentFilterCategory").innerHTML = `<option value="">كل التصنيفات</option>` + opts;
    $("repCategory").innerHTML = `<option value="">كل التصنيفات</option>` + opts;
    $("uploadCategory").innerHTML = opts + `<option value="__new__">➕ تصنيف جديد...</option>`;
  }
  function fillMemberSelect(){
    const list = memberList();
    const cur = $("filterMember").value;
    const opts = list.map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join("");
    $("filterMember").innerHTML = `<option value="">كل الأعضاء</option>` + opts;
    $("filterMember").value = cur;
    const curS = $("sentFilterMember").value;
    $("sentFilterMember").innerHTML = `<option value="">كل الأعضاء</option>` + opts;
    $("sentFilterMember").value = curS;
  }
  function renderAll(){ renderStats(); renderTable(); fillMemberSelect(); renderReports(); renderSentPage(); }

  // ============================================================
  // الأحداث
  // ============================================================
  async function onRowClick(e){
    const btn = e.target.closest("button[data-act]"); if(!btn) return;
    const rowEl = e.target.closest("tr") || e.target.closest(".contact-card");
    if(!rowEl) return;
    const id = rowEl.dataset.id;
    const c = contacts.find(x=>String(x.id)===String(id)); if(!c) return;
    try{
      if(btn.dataset.act==="send"){
        if(c.status==="new"){
          const claimed = await api.claim(c.id);
          if(!claimed){ toast("الرقم ده حجزه حد تاني للتو!"); await refresh(); return; }
          Object.assign(c, claimed);
        }
        window.open(waLink(c.phone), "_blank");
        // تسجيل "اتبعت" تلقائيًا بعد فتح واتساب
        await api.setStatus(c.id, "sent");
        c.status = "sent"; c.sent_by_email = user.email; c.sent_at = new Date().toISOString();
        toast("اتفتح واتساب وسُجِّل إنه اتبعت ✓");
        renderAll();
      } else if(btn.dataset.act==="sent"){ await api.setStatus(c.id,"sent"); c.status="sent"; c.sent_by_email=user.email; toast("اتسجّل إنه اتبعت ✓"); renderAll(); }
      else if(btn.dataset.act==="reply"){ await api.setStatus(c.id,"replied"); c.status="replied"; if(!c.sent_by_email) c.sent_by_email=user.email; renderAll(); }
      else if(btn.dataset.act==="no"){ await api.setStatus(c.id,"no_answer"); c.status="no_answer"; renderAll(); }
    }catch(err){ toast("حصل خطأ: "+(err.message||err)); }
  }
  async function refresh(){ await api.loadContacts(); renderAll(); }

  // ---------- التبويبات ----------
  function switchTab(name){
    document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active", t.dataset.tab===name));
    $("contactsPage").classList.toggle("hidden", name!=="contacts");
    $("sentPage").classList.toggle("hidden", name!=="sent");
    $("messagesPage").classList.toggle("hidden", name!=="messages");
    $("reportsPage").classList.toggle("hidden", name!=="reports");
    if(name==="reports") renderReports();
    if(name==="sent") renderSentPage();
  }

  // ---------- صفحة الرسائل ----------
  function renderMessages(){
    const msgs = (CFG.MESSAGES || []);
    if(!msgs.length){ $("messagesList").innerHTML = `<p class="muted" style="text-align:center;padding:40px">مفيش رسائل مخزّنة حتى الآن.</p>`; return; }
    $("messagesList").innerHTML = msgs.map((m, i) => `
      <div class="msg-card">
        <div class="msg-head">
          <span class="msg-num">${i+1}</span>
          <strong class="msg-title">${esc(m.title)}</strong>
          <button class="btn btn-sm btn-copy" data-idx="${i}" id="copy-${esc(m.label||i)}">📋 نسخ</button>
        </div>
        <pre class="msg-body">${esc(m.text)}</pre>
      </div>
    `).join("");
    // أحداث النسخ
    $("messagesList").querySelectorAll(".btn-copy").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = +btn.dataset.idx;
        const text = msgs[idx].text;
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = "✅ اتنسخ!";
          btn.style.background = "var(--green)";
          setTimeout(() => { btn.textContent = "📍 نسخ"; btn.style.background = ""; }, 1800);
        }).catch(() => toast("حدد النص وانسخه يدويًا"));
      });
    });
  }

  // ---------- رفع CSV ----------
  function openModal(){ $("uploadModal").classList.remove("hidden"); }
  function closeModal(){
    $("uploadModal").classList.add("hidden"); parsedRows=null; $("csvFile").value="";
    $("fileLabel").textContent="📁 اختر ملف Excel أو CSV (أعمدة: name, phone, city, location)";
    $("uploadPreview").classList.add("hidden"); $("uploadResult").classList.add("hidden"); $("confirmUpload").disabled=true;
  }
  function onCategoryChange(){ $("newCategoryRow").classList.toggle("hidden", $("uploadCategory").value!=="__new__"); }

  function processRows(rawRows){
    const seen=new Set(), rows=[]; let invalid=0, dupInFile=0;
    rawRows.forEach(r=>{
      const phone = normalizePhone(r.phone || r.Phone || r["الرقم"] || r["الهاتف"]);
      if(!phone){ invalid++; return; }
      if(seen.has(phone)){ dupInFile++; return; }
      seen.add(phone);
      rows.push({ phone,
        name:(r.name||r.Name||r["الاسم"]||"").trim()||null,
        city:(r.city||r.City||r["المدينة"]||"").trim()||null,
        location:(r.location||r.Location||r["الموقع"]||r["العنوان"]||"").trim()||null });
    });
    parsedRows = rows;
    const prev = rows.slice(0,5).map(r=>`<tr><td>${esc(r.name||"—")}</td><td dir="ltr">${esc(r.phone)}</td><td>${esc(r.city||"—")}</td></tr>`).join("");
    $("uploadPreview").innerHTML = `<strong>جاهز للرفع: ${rows.length} رقم</strong>`+
      (dupInFile?` · مكرر داخل الملف: ${dupInFile}`:"")+(invalid?` · غير صالح: ${invalid}`:"")+
      (rows.length?`<table><thead><tr><th>الاسم</th><th>الرقم</th><th>المدينة</th></tr></thead><tbody>${prev}</tbody></table>`:"");
    $("uploadPreview").classList.remove("hidden"); $("confirmUpload").disabled = rows.length===0;
  }

  function handleFile(file){
    if(!file) return;
    $("fileLabel").textContent = "📄 " + file.name;
    const ext = file.name.split(".").pop().toLowerCase();
    if(ext==="xlsx" || ext==="xls"){
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type:"array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rawRows = XLSX.utils.sheet_to_json(ws, { defval:"" });
        processRows(rawRows);
      };
      reader.readAsArrayBuffer(file);
    } else {
      Papa.parse(file, { header:true, skipEmptyLines:true, complete:(res)=>processRows(res.data) });
    }
  }

  async function confirmUpload(){
    if(!parsedRows || !parsedRows.length) return;
    let category = $("uploadCategory").value;
    if(category==="__new__"){ const name=$("newCategoryName").value.trim(); if(!name){ toast("اكتب اسم التصنيف الجديد"); return; } await api.addCategory(name); category=name; }
    const rows = parsedRows.map(r=>Object.assign({}, r, { category }));
    $("confirmUpload").disabled=true; $("confirmUpload").textContent="جاري الرفع...";
    try{
      const added = await api.upload(rows); const skipped = rows.length - added;
      fillCategorySelects(); await refresh();
      $("uploadResult").className="result ok";
      $("uploadResult").innerHTML = `✅ تمت إضافة <strong>${added}</strong> رقم جديد · تم تجاهل <strong>${skipped}</strong> رقم مكرر.`;
      $("uploadResult").classList.remove("hidden"); toast("تم الرفع ✓");
    }catch(err){ $("uploadResult").className="result"; $("uploadResult").style.color="var(--red)"; $("uploadResult").textContent="خطأ: "+(err.message||err); $("uploadResult").classList.remove("hidden"); }
    finally{ $("confirmUpload").textContent="رفع وتجاهل المكرر"; $("confirmUpload").disabled=false; parsedRows=null; $("csvFile").value=""; }
  }

  // ============================================================
  async function startApp(){
    $("authView").classList.add("hidden"); $("appView").classList.remove("hidden");
    const userPrefix = (user.email || "user").split("@")[0];
    $("userEmail").textContent = userPrefix; 
    $("userAvatar").textContent = userPrefix.charAt(0).toUpperCase(); 
    $("demoBadge").classList.toggle("hidden", !DEMO);
    await api.loadCategories(); fillCategorySelects(); onCategoryChange();
    renderMessages();
    await refresh(); api.subscribe(()=>refresh());
  }

  function bind(){
    $("loginForm").addEventListener("submit", async (e)=>{ e.preventDefault(); $("authError").classList.add("hidden");
      try{ await api.signIn($("email").value, $("password").value); await startApp(); }
      catch(err){ $("authError").textContent="تعذر الدخول: "+(err.message||err); $("authError").classList.remove("hidden"); } });
    $("logoutBtn").addEventListener("click", ()=>api.signOut());
    document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click", ()=>switchTab(t.dataset.tab)));
    $("contactsBody").addEventListener("click", onRowClick);
    $("contactsMobileList").addEventListener("click", onRowClick);
    ["filterCategory","filterStatus","filterMember"].forEach(id=>$(id).addEventListener("change", renderTable));
    ["filterCity","searchInput"].forEach(id=>$(id).addEventListener("input", renderTable));
    ["repCategory"].forEach(id=>$(id).addEventListener("change", renderReports));
    ["repCity","repMember"].forEach(id=>$(id).addEventListener("input", renderReports));
    ["sentFilterCategory","sentFilterMember"].forEach(id=>$(id).addEventListener("change", renderSentPage));
    ["sentFilterCity","sentSearch"].forEach(id=>$(id).addEventListener("input", renderSentPage));
    $("uploadBtn").addEventListener("click", openModal);
    $("closeModal").addEventListener("click", closeModal);
    $("uploadCategory").addEventListener("change", onCategoryChange);
    $("csvFile").addEventListener("change", (e)=>handleFile(e.target.files[0]));
    $("confirmUpload").addEventListener("click", confirmUpload);
    $("uploadModal").addEventListener("click", (e)=>{ if(e.target===$("uploadModal")) closeModal(); });
    $("waModeSelect").addEventListener("change", (e) => {
      localStorage.setItem("wa_mode", e.target.value);
    });
  }

  async function init(){
    // استرجاع طريقة الإرسال المفضلة
    const savedMode = localStorage.getItem("wa_mode") || "wa.me";
    $("waModeSelect").value = savedMode;
    bind();
    if(!DEMO){
      sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
      const { data } = await sb.auth.getUser();
      if(data && data.user){ user = data.user; return startApp(); }
      $("authView").classList.remove("hidden");
    }else{ user = { email:"demo@ojlinker.com", id:"demo" }; await startApp(); }
  }

  // بيانات وهمية للوضع التجريبي
  const DEMO_DATA = [
    { id:"1", phone:"201001234567", name:"صالون النخبة", city:"القاهرة", location:"مدينة نصر", category:"صالون", status:"new" },
    { id:"2", phone:"201112345678", name:"صالون ليان", city:"الجيزة", location:"المهندسين", category:"صالون", status:"sent", sent_by_email:"ali@ojlinker.com" },
    { id:"3", phone:"201223456789", name:"صالون روز", city:"الإسكندرية", location:"سموحة", category:"صالون", status:"sent", sent_by_email:"mona@ojlinker.com" },
    { id:"4", phone:"201098765432", name:"عيادة الشفاء", city:"القاهرة", location:"التجمع الخامس", category:"عيادة", status:"replied", sent_by_email:"mona@ojlinker.com" },
    { id:"5", phone:"201555555555", name:"فندق الأندلس", city:"الغردقة", location:"الكورنيش", category:"فندق", status:"sent", sent_by_email:"ali@ojlinker.com" },
    { id:"6", phone:"201211112222", name:"صالون جلامروز", city:"القاهرة", location:"مدينة نصر", category:"صالون", status:"new" },
    { id:"7", phone:"201233334444", name:"عيادة النور", city:"طنطا", location:"وسط البلد", category:"عيادة", status:"sent", sent_by_email:"ali@ojlinker.com" },
    { id:"8", phone:"201066667777", name:"فندق الماسة", city:"الغردقة", location:"الممشى السياحي", category:"فندق", status:"sent", sent_by_email:"mona@ojlinker.com" }
  ];

  document.addEventListener("DOMContentLoaded", init);
})();
