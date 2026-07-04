/* ============================================================
   طبقة الاتصال بالخادم (API)
   لا يوجد هنا أي محتوى للدورة أو إجابات صحيحة — كل ذلك يُطلب
   من الخادم عند الحاجة فقط.
   ============================================================ */
const TOKEN_KEY = 'genai_course_ar_token';
const PROGRESS_STORAGE_KEY = 'genai_course_ar_progress_v2';

function getToken(){ return localStorage.getItem(TOKEN_KEY); }
function setToken(t){ localStorage.setItem(TOKEN_KEY, t); }
function clearToken(){ localStorage.removeItem(TOKEN_KEY); }

async function api(path, options = {}){
  const headers = Object.assign({'Content-Type':'application/json'}, options.headers || {});
  const token = getToken();
  if(token) headers.Authorization = 'Bearer ' + token;
  let res;
  try{
    res = await fetch('/api' + path, Object.assign({}, options, {headers}));
  }catch(e){
    throw {network:true, message:'تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت وحاول مجدداً.'};
  }
  if(res.status === 401){
    clearToken();
    showLoginGate('انتهت الجلسة، يرجى إدخال كلمة المرور مجدداً.');
    throw {unauthorized:true};
  }
  let data = null;
  try{ data = await res.json(); }catch(e){ /* no body */ }
  if(!res.ok){
    throw Object.assign({status:res.status}, data || {message:'حدث خطأ غير متوقع.'});
  }
  return data;
}

/* ============================================================
   بوابة كلمة المرور — التحقق يحدث على الخادم فقط
   ملاحظة: حقل كلمة المرور من نوع "text" عمداً وغير مموّه.
   ============================================================ */
function showLoginGate(errorMsg){
  let overlay = document.getElementById('studentGateOverlay');
  if(overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'studentGateOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(20,20,16,0.55);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:Tajawal,sans-serif;';
  overlay.innerHTML = `
    <div style="background:#faf7f0;padding:32px 28px;border-radius:10px;max-width:340px;width:90%;box-shadow:0 10px 40px rgba(0,0,0,0.3);text-align:center;direction:rtl;">
      <div style="font-size:32px;margin-bottom:8px;">🎓</div>
      <h2 style="margin:0 0 8px;font-family:'Tajawal',sans-serif;font-size:1.2rem;font-weight:700;">مرحباً بك</h2>
      <p style="margin:0 0 16px;color:#5a5e54;font-size:.9rem;">أدخل كلمة مرور الدورة للمتابعة.</p>
      <input id="studentNameInput" type="text" autocomplete="off" placeholder="كلمة المرور" style="width:100%;padding:10px 12px;border:1px solid #dcd5c2;border-radius:6px;font-size:.95rem;margin-bottom:10px;box-sizing:border-box;text-align:right;font-family:'Tajawal',sans-serif;">
      <div id="studentGateError" style="color:#b3413a;font-size:.8rem;min-height:18px;margin-bottom:6px;">${errorMsg || ''}</div>
      <button id="studentGateBtn" style="width:100%;padding:10px;border:none;border-radius:6px;background:#0f6e64;color:#fff;font-size:.95rem;cursor:pointer;font-family:'Tajawal',sans-serif;font-weight:700;">متابعة</button>
    </div>`;
  document.body.appendChild(overlay);
  const input = document.getElementById('studentNameInput');
  const btn = document.getElementById('studentGateBtn');
  input.focus();
  async function submit(){
    const pw = input.value.trim();
    const errEl = document.getElementById('studentGateError');
    if(!pw){ errEl.textContent = 'يرجى إدخال كلمة المرور.'; return; }
    btn.disabled = true;
    errEl.textContent = '';
    try{
      const res = await fetch('/api/login', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({password: pw})
      });
      const data = await res.json().catch(()=>({}));
      if(!res.ok){
        errEl.textContent = data.message || 'كلمة المرور غير صحيحة.';
        btn.disabled = false;
        return;
      }
      setToken(data.token);
      overlay.remove();
      boot();
    }catch(e){
      errEl.textContent = 'تعذر الاتصال بالخادم. حاول مجدداً.';
      btn.disabled = false;
    }
  }
  btn.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if(e.key === 'Enter') submit(); });
}

async function switchStudent(){
  try{ await api('/logout', {method:'POST'}); }catch(e){ /* ignore */ }
  clearToken();
  location.reload();
}

/* ============================================================
   تقدّم الطالب — يبقى محفوظاً في هذا المتصفح فقط (لا يحتوي على
   أي إجابات صحيحة، فقط ما أنجزه الطالب)
   ============================================================ */
function loadProgress(){
  try{ return JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY)) || {done:{}, quizScores:{}, lessonQuiz:{}}; }
  catch(e){ return {done:{}, quizScores:{}, lessonQuiz:{}}; }
}
function saveProgress(p){ localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(p)); }
let progress = loadProgress();

/* ============================================================
   حالة التطبيق: فقط "الخريطة" (structure) موجودة في الذاكرة —
   لا تحتوي على نصوص الدروس أو الإجابات الصحيحة. محتوى الدرس
   الحالي فقط يتم جلبه من الخادم عند فتحه.
   ============================================================ */
let STRUCTURE = null;
let FLAT = [];
let currentIndex = -1;
const quizState = {};     // إجابات مؤقتة أثناء تعبئة اختبار الوحدة الحالي
const lqSelected = {};    // إجابة مؤقتة أثناء تعبئة الاختبار السريع الحالي
let currentLessonData = null; // بيانات الدرس المعروض حالياً فقط

function buildFlat(){
  FLAT = [];
  STRUCTURE.modules.forEach((m, mi) => {
    m.lessons.forEach((l, li) => FLAT.push({type:'lesson', mi, li}));
    FLAT.push({type:'quiz', mi});
  });
  FLAT.push({type:'project'});
}

function keyFor(item){
  if(item.type==='lesson') return `l-${item.mi}-${item.li}`;
  if(item.type==='quiz') return `q-${item.mi}`;
  return 'project';
}

function markDone(k, val){
  progress.done[k] = val;
  saveProgress(progress);
  updateOverallProgress();
}

function updateOverallProgress(){
  const totalLessons = FLAT.filter(f=>f.type==='lesson').length + STRUCTURE.modules.length + 1;
  let doneCount = 0;
  STRUCTURE.modules.forEach((m, mi) => {
    m.lessons.forEach((l, li) => { if(progress.done[`l-${mi}-${li}`]) doneCount++; });
    if(progress.done[`q-${mi}`]) doneCount++;
  });
  if(progress.done['project']) doneCount++;
  const pct = Math.round((doneCount/totalLessons)*100);
  const fill = document.getElementById('overallFill');
  const pctEl = document.getElementById('overallPct');
  const topbarPct = document.getElementById('topbarPct');
  if(fill) fill.style.width = pct+'%';
  if(pctEl) pctEl.textContent = `٪${pct} مكتمل`;
  if(topbarPct) topbarPct.textContent = `٪${pct}`;
}

function setActiveNav(idx){
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.remove('active'));
  const item = FLAT[idx];
  if(!item) return;
  const k = keyFor(item);
  const el = document.getElementById('navitem-'+k);
  if(el){
    el.classList.add('active');
    const modParent = el.closest('.nav-mod');
    if(modParent) modParent.classList.add('open');
  }
}

function buildNav(){
  const tree = document.getElementById('navTree');
  tree.innerHTML = '';
  let lastPart = -1;
  STRUCTURE.modules.forEach((m, mi) => {
    if(m.part !== lastPart){
      lastPart = m.part;
      const pb = document.createElement('div');
      pb.className='part-block';
      const lbl = document.createElement('div');
      lbl.className='part-label';
      lbl.style.background = STRUCTURE.parts[m.part].color;
      lbl.textContent = STRUCTURE.parts[m.part].label;
      pb.appendChild(lbl);
      tree.appendChild(pb);
    }
    const modDiv = document.createElement('div');
    modDiv.className = 'nav-mod';
    modDiv.id = 'navmod-'+mi;
    const head = document.createElement('div');
    head.className = 'nav-mod-title';
    head.innerHTML = `<span class="nav-mod-num">${m.num}</span><span>${m.icon} ${m.title}</span><span class="caret">◀</span>`;
    head.onclick = () => { modDiv.classList.toggle('open'); };
    modDiv.appendChild(head);

    const lessonsWrap = document.createElement('div');
    lessonsWrap.className = 'nav-lessons';
    m.lessons.forEach((l, li) => {
      const k = `l-${mi}-${li}`;
      const item = document.createElement('div');
      item.className = 'nav-item' + (progress.done[k] ? ' done' : '');
      item.id = 'navitem-'+k;
      item.innerHTML = `<span class="dot">${progress.done[k]?'✓':''}</span><span>${l.title}</span>`;
      item.onclick = () => goTo(FLAT.findIndex(f=>f.type==='lesson'&&f.mi===mi&&f.li===li));
      lessonsWrap.appendChild(item);
    });
    const qk = `q-${mi}`;
    const quizItem = document.createElement('div');
    quizItem.className = 'nav-item quiz-item' + (progress.done[qk] ? ' done' : '');
    quizItem.id = 'navitem-'+qk;
    quizItem.innerHTML = `<span class="dot">📋</span><span>${m.quiz.title}</span>`;
    quizItem.onclick = () => goTo(FLAT.findIndex(f=>f.type==='quiz'&&f.mi===mi));
    lessonsWrap.appendChild(quizItem);
    modDiv.appendChild(lessonsWrap);
    tree.appendChild(modDiv);
  });

  const pb = document.createElement('div');
  pb.className='part-block';
  const lbl = document.createElement('div');
  lbl.className='part-label';
  lbl.style.background = 'var(--ink)';
  lbl.textContent = 'المشروع النهائي';
  pb.appendChild(lbl);
  const projItem = document.createElement('div');
  projItem.className = 'nav-item quiz-item' + (progress.done['project'] ? ' done' : '');
  projItem.id = 'navitem-project';
  projItem.style.marginRight = '20px';
  projItem.innerHTML = `<span class="dot">🎓</span><span>${STRUCTURE.finalProjectTitle}</span>`;
  projItem.onclick = () => goTo(FLAT.findIndex(f=>f.type==='project'));
  pb.appendChild(projItem);
  tree.appendChild(pb);
}

function renderHome(){
  currentIndex = -1;
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.remove('active'));
  const wrap = document.getElementById('contentWrap');
  wrap.innerHTML = `
    <div class="hero">
      <div class="hero-tag">✦ مدرسة سلواني · EFIEG</div>
      <h1>الذكاء الاصطناعي<br>في حياتي اليومية</h1>
      <p>من فهم كيف يعمل الذكاء الاصطناعي، إلى استخدامه بأمان وذكاء في دراستك وحياتك اليومية — مع رسوم بيانية تفاعلية، واختبار قصير بعد كل درس، ومشروع ختامي عملي.</p>
      <div class="hero-stats">
        <div class="hero-stat"><span class="hstat-num">٧</span><span class="hstat-label">وحدات</span></div>
        <div class="hero-stat"><span class="hstat-num">٢٨</span><span class="hstat-label">دروس</span></div>
        <div class="hero-stat"><span class="hstat-num">٣٥</span><span class="hstat-label">اختبارات</span></div>
        <div class="hero-stat"><span class="hstat-num">١٦</span><span class="hstat-label">ساعة إجمالاً</span></div>
      </div>
      <button class="start-btn" onclick="goTo(0)">ابدأ التعلم</button>
      <div class="howto" style="margin-top:28px;">
        <h3>✦ ماذا يتضمن هذا البرنامج؟</h3>
        <div class="howto-grid">
          <div class="howto-item"><span class="howto-icon">⚡</span><span>اختبار قصير بعد كل درس</span></div>
          <div class="howto-item"><span class="howto-icon">🎛️</span><span>رسوم بيانية وتجارب تفاعلية</span></div>
          <div class="howto-item"><span class="howto-icon">📋</span><span>اختبارات شاملة في نهاية كل وحدة</span></div>
          <div class="howto-item"><span class="howto-icon">💾</span><span>يتم حفظ تقدمك تلقائياً</span></div>
        </div>
      </div>
    </div>
  `;
  document.title = 'الذكاء الاصطناعي في حياتي اليومية — الدورة الكاملة';
  const heroLogo = document.createElement('div');
  heroLogo.className = 'hero-logo-wrap';
  heroLogo.innerHTML = `
    <img src="/assets/logo.jpg" alt="EFIEG" class="hero-logo-img">
    <div class="hero-logo-text">
      <div class="hero-logo-school">مدرسة سلواني · EFIEG</div>
      <div class="hero-logo-name">الذكاء الاصطناعي<br>في حياتي اليومية</div>
      <div class="hero-logo-sub">برنامج تفاعلي مدته ١٦ ساعة</div>
    </div>
  `;
  const heroSection = document.querySelector('.hero');
  if(heroSection) heroSection.insertBefore(heroLogo, heroSection.firstChild);
  updateOverallProgress();
}

function renderError(message){
  const wrap = document.getElementById('contentWrap');
  wrap.innerHTML = `<div class="callout" style="border-color:var(--bad);">⚠️ ${message}</div>
    <div class="lesson-nav"><button class="nav-btn" onclick="renderHome()">العودة إلى الصفحة الرئيسية</button></div>`;
}

function injectDiagramAndRunScripts(container, html){
  if(!html) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;

  const scripts = wrapper.querySelectorAll('script');
  scripts.forEach(s => s.remove());

  wrapper.querySelectorAll('canvas').forEach(canvas => {
    const existingId = canvas.id;
    if(existingId){
      const old = document.getElementById(existingId);
      if(old && window.Chart){
        const existing = Chart.getChart(old);
        if(existing) existing.destroy();
      }
    }
  });

  container.appendChild(wrapper);

  scripts.forEach(s => {
    try {
      const scriptEl = document.createElement('script');
      scriptEl.textContent = s.textContent;
      document.body.appendChild(scriptEl);
    } catch(e){ console.warn('diagram script error:', e); }
  });
}

/* ============================================================
   الاختبار السريع داخل الدرس — الأسئلة/الخيارات تأتي مع بيانات
   الدرس، لكن التصحيح الفعلي يتم على الخادم عند الإرسال.
   ============================================================ */
function buildLessonQuiz(mi, li, lq, container){
  if(!lq) return;
  const key = `${mi}-${li}`;
  const saved = progress.lessonQuiz[key];
  const answered = !!saved;

  const arabicLetters = ['أ','ب','ج','د'];

  const div = document.createElement('div');
  div.className = 'lesson-quiz';
  div.id = `lq-${mi}-${li}`;

  div.innerHTML = `
    <div class="lesson-quiz-header">
      <span class="lesson-quiz-badge">اختبار سريع</span>
      <span class="lesson-quiz-title">اختبر فهمك</span>
    </div>
    <div class="lq-question-text">${lq.q}</div>
    <div class="lq-opts" id="lqopts-${mi}-${li}">
      ${lq.opts.map((o,i)=>`
        <div class="lq-opt ${answered && saved.chosen===i ? 'selected':''} ${answered && i===saved.correctIndex ? 'correct':''} ${answered && i===saved.chosen && saved.chosen!==saved.correctIndex ? 'incorrect':''} ${answered?'disabled':''}"
             data-idx="${i}" ${answered?'':'onclick="selectLQ('+mi+','+li+','+i+')"'}>
          <span class="lq-letter">${arabicLetters[i]}</span>
          <span>${o}</span>
        </div>`).join('')}
    </div>
    <div class="lq-feedback ${answered?(saved.chosen===saved.correctIndex?'show correct-fb':'show wrong-fb'):''}" id="lqfb-${mi}-${li}">
      ${answered?(saved.chosen===saved.correctIndex?'✅ إجابة صحيحة! ':'❌ ليست صحيحة تماماً. ')+saved.explain:''}
    </div>
    ${!answered
      ? `<button class="lq-submit" id="lqbtn-${mi}-${li}" onclick="submitLQ(${mi},${li})" disabled>تحقق من الإجابة</button>`
      : `<button class="lq-retry" onclick="resetLQ(${mi},${li})">↺ حاول مجدداً</button>`
    }
  `;
  container.appendChild(div);
}

function selectLQ(mi, li, idx){
  const key = `${mi}-${li}`;
  lqSelected[key] = idx;
  const container = document.getElementById(`lqopts-${mi}-${li}`);
  container.querySelectorAll('.lq-opt').forEach(el => {
    el.classList.toggle('selected', parseInt(el.dataset.idx)===idx);
  });
  const btn = document.getElementById(`lqbtn-${mi}-${li}`);
  if(btn) btn.disabled = false;
}

async function submitLQ(mi, li){
  const key = `${mi}-${li}`;
  const chosen = lqSelected[key];
  if(chosen === undefined) return;

  let result;
  try{
    result = await api(`/lesson-quiz/${mi}/${li}/submit`, {method:'POST', body: JSON.stringify({answer: chosen})});
  }catch(e){
    if(!e.unauthorized) renderInlineError(`lqfb-${mi}-${li}`, e.message || 'تعذر إرسال الإجابة، حاول مجدداً.');
    return;
  }

  progress.lessonQuiz[key] = {chosen, correctIndex: result.correctIndex, explain: result.explain};
  saveProgress(progress);

  const container = document.getElementById(`lqopts-${mi}-${li}`);
  container.querySelectorAll('.lq-opt').forEach(el => {
    const idx = parseInt(el.dataset.idx);
    el.classList.add('disabled');
    el.onclick = null;
    if(idx === result.correctIndex) el.classList.add('correct');
    else if(idx === chosen) el.classList.add('incorrect');
  });

  const fb = document.getElementById(`lqfb-${mi}-${li}`);
  fb.textContent = (result.isCorrect ? '✅ إجابة صحيحة! ' : '❌ ليست صحيحة تماماً. ') + result.explain;
  fb.className = 'lq-feedback show ' + (result.isCorrect ? 'correct-fb' : 'wrong-fb');

  const btn = document.getElementById(`lqbtn-${mi}-${li}`);
  if(btn){
    btn.outerHTML = `<button class="lq-retry" onclick="resetLQ(${mi},${li})">↺ حاول مجدداً</button>`;
  }
}

function resetLQ(mi, li){
  const key = `${mi}-${li}`;
  delete progress.lessonQuiz[key];
  delete lqSelected[key];
  saveProgress(progress);
  const mountDiv = document.getElementById(`lq-${mi}-${li}`);
  if(mountDiv){ mountDiv.remove(); }
  const quizMount = document.getElementById('lessonQuizMount');
  if(quizMount && currentLessonData) buildLessonQuiz(mi, li, currentLessonData.lessonQuiz, quizMount);
}

function renderInlineError(elId, message){
  const el = document.getElementById(elId);
  if(el){ el.textContent = '⚠️ ' + message; el.classList.add('show'); }
}

/* ============================================================
   عرض درس واحد — يُطلب من الخادم فقط عند فتحه (وليس دفعة واحدة)
   ============================================================ */
async function renderLesson(idx){
  currentIndex = idx;
  setActiveNav(idx);
  const item = FLAT[idx];
  const m = STRUCTURE.modules[item.mi];
  const k = keyFor(item);

  const wrap = document.getElementById('contentWrap');
  wrap.innerHTML = `<div class="callout">⏳ جارٍ تحميل الدرس…</div>`;

  let lesson;
  try{
    lesson = await api(`/lesson/${item.mi}/${item.li}`);
  }catch(e){
    if(!e.unauthorized) renderError(e.message || 'تعذر تحميل الدرس. حاول مجدداً.');
    return;
  }
  currentLessonData = lesson;
  const isDone = !!progress.done[k];

  wrap.innerHTML = `
    <div class="crumb">${STRUCTURE.parts[m.part].label} · الوحدة ${m.num} · ${m.title}</div>
    <div class="lesson-title">${lesson.title}</div>
    <div class="lesson-meta">
      <span>⏱ ${lesson.time}</span>
      <span>${m.level}</span>
    </div>
    <div class="lesson-body" id="lessonBody">${lesson.body}</div>
    <div id="lessonDiagram"></div>
    <div id="lessonQuizMount"></div>
    <div class="mark-row">
      <div class="mark-complete ${isDone?'done':''}" id="markBtn" onclick="toggleDone('${k}')">
        ${isDone?'✓ تم الإكمال':'وضع علامة مكتمل'}
      </div>
    </div>
    <div class="lesson-nav">
      <button class="nav-btn" id="prevBtn">السابق ‹</button>
      <button class="nav-btn primary" id="nextBtn">› التالي</button>
    </div>
  `;

  const diagramContainer = document.getElementById('lessonDiagram');
  if(lesson.diagramHtml) injectDiagramAndRunScripts(diagramContainer, lesson.diagramHtml);

  const quizMount = document.getElementById('lessonQuizMount');
  if(lesson.lessonQuiz) buildLessonQuiz(item.mi, item.li, lesson.lessonQuiz, quizMount);

  wirePrevNext(idx);
  document.title = lesson.title + ' — دورة الذكاء الاصطناعي';
  window.scrollTo(0,0);
  closeSidebar();
}

function toggleDone(k){
  markDone(k, !progress.done[k]);
  const btn = document.getElementById('markBtn');
  if(btn){
    btn.classList.toggle('done', !!progress.done[k]);
    btn.textContent = progress.done[k] ? '✓ تم الإكمال' : 'وضع علامة مكتمل';
  }
  buildNav();
}

/* ============================================================
   اختبار الوحدة — الأسئلة تأتي بدون الإجابة الصحيحة، والخادم هو
   من يصحّح عند الإرسال.
   ============================================================ */
async function renderQuiz(idx){
  currentIndex = idx;
  setActiveNav(idx);
  const item = FLAT[idx];
  const m = STRUCTURE.modules[item.mi];
  const k = keyFor(item);
  const wrap = document.getElementById('contentWrap');

  wrap.innerHTML = `<div class="callout">⏳ جارٍ تحميل الاختبار…</div>`;

  let quiz;
  try{
    quiz = await api(`/quiz/${item.mi}`);
  }catch(e){
    if(!e.unauthorized) renderError(e.message || 'تعذر تحميل الاختبار. حاول مجدداً.');
    return;
  }

  const arabicLetters = ['أ','ب','ج','د'];
  let qHtml = '';
  quiz.questions.forEach((q, qi) => {
    let optsHtml = '';
    q.opts.forEach((opt, oi) => {
      optsHtml += `<div class="quiz-opt" data-q="${qi}" data-o="${oi}" onclick="selectQuizOption(${item.mi},${qi},${oi})">
        <span class="letter">${arabicLetters[oi]}</span><span>${opt}</span>
      </div>`;
    });
    qHtml += `<div class="quiz-q" id="quizq-${qi}">
      <div class="quiz-q-text">${qi+1}. ${q.q}</div>
      <div class="quiz-opts">${optsHtml}</div>
      <div class="quiz-explain" id="explain-${qi}"></div>
    </div>`;
  });

  wrap.innerHTML = `
    <div class="crumb">${STRUCTURE.parts[m.part].label} · الوحدة ${m.num} · ${m.title}</div>
    <div class="lesson-title">${quiz.title}</div>
    <div class="lesson-meta"><span>📋 ${quiz.questions.length} أسئلة</span></div>
    <div class="quiz-result" id="quizResult"></div>
    <div id="quizQuestions">${qHtml}</div>
    <div class="quiz-actions">
      <button class="nav-btn primary" id="submitQuizBtn" onclick="submitQuiz(${item.mi})">إرسال الإجابات</button>
      <button class="nav-btn" id="retakeBtn" style="display:none" onclick="retakeQuiz(${item.mi})">إعادة المحاولة</button>
    </div>
    <div class="lesson-nav">
      <button class="nav-btn" id="prevBtn">السابق ‹</button>
      <button class="nav-btn primary" id="nextBtn">› التالي</button>
    </div>
  `;
  wirePrevNext(idx);

  const saved = progress.quizScores[k];
  if(saved && saved.results){
    saved.results.forEach((r,qi)=>{ if(r.chosen!=null) selectQuizOption(item.mi, qi, r.chosen); });
    showQuizResult(item.mi);
  }
  window.scrollTo(0,0);
  closeSidebar();
}

function selectQuizOption(mi, qi, oi){
  quizState[mi] = quizState[mi] || {answers:[]};
  quizState[mi].answers[qi] = oi;
  const qBlock = document.getElementById('quizq-'+qi);
  if(!qBlock) return;
  qBlock.querySelectorAll('.quiz-opt').forEach(el=>{
    el.classList.toggle('selected', parseInt(el.dataset.o)===oi);
  });
}

async function submitQuiz(mi){
  const state = quizState[mi] || {answers:[]};
  let result;
  try{
    result = await api(`/quiz/${mi}/submit`, {method:'POST', body: JSON.stringify({answers: state.answers})});
  }catch(e){
    if(!e.unauthorized) renderError(e.message || 'تعذر إرسال الإجابات. حاول مجدداً.');
    return;
  }

  const item = FLAT.find(f=>f.type==='quiz'&&f.mi===mi);
  const k = keyFor(item);
  progress.quizScores[k] = {results: result.results, score: result.score, total: result.total, submitted:true};
  const pass = result.score >= Math.ceil(result.total*0.6);
  if(pass) markDone(k, true); else saveProgress(progress);

  result.results.forEach((r, qi) => {
    const qBlock = document.getElementById('quizq-'+qi);
    if(!qBlock) return;
    qBlock.querySelectorAll('.quiz-opt').forEach(el=>{
      el.classList.add('disabled');
      el.onclick = null;
      const oi = parseInt(el.dataset.o);
      if(oi===r.correctIndex) el.classList.add('correct');
      else if(oi===r.chosen) el.classList.add('incorrect');
    });
    const exp = document.getElementById('explain-'+qi);
    if(exp){ exp.textContent = '💡 ' + r.explain; exp.classList.add('show'); }
  });

  showQuizResult(mi);
  document.getElementById('submitQuizBtn').style.display='none';
  document.getElementById('retakeBtn').style.display='inline-block';
  buildNav();
}

function showQuizResult(mi){
  const item = FLAT.find(f=>f.type==='quiz'&&f.mi===mi);
  const k = keyFor(item);
  const saved = progress.quizScores[k];
  if(!saved) return;
  const pass = saved.score >= Math.ceil(saved.total*0.6);
  const el = document.getElementById('quizResult');
  el.className = 'quiz-result show ' + (pass?'pass':'fail');
  el.innerHTML = `<div class="score">${saved.score} / ${saved.total}</div><p>${pass ? "عمل رائع — لقد اجتزت هذا الاختبار." : "ليس بعد — راجع الشروحات أدناه ثم أعد المحاولة."}</p>`;
  const submitBtn = document.getElementById('submitQuizBtn');
  const retakeBtn = document.getElementById('retakeBtn');
  if(submitBtn) submitBtn.style.display='none';
  if(retakeBtn) retakeBtn.style.display='inline-block';
  saved.results.forEach((r,qi)=>{
    const qBlock = document.getElementById('quizq-'+qi);
    if(!qBlock) return;
    qBlock.querySelectorAll('.quiz-opt').forEach(opEl=>{
      opEl.classList.add('disabled');
      opEl.onclick = null;
      const oi = parseInt(opEl.dataset.o);
      if(oi===r.correctIndex) opEl.classList.add('correct');
      else if(oi===r.chosen) opEl.classList.add('incorrect');
      if(oi===r.chosen) opEl.classList.add('selected');
    });
    const exp = document.getElementById('explain-'+qi);
    if(exp){ exp.textContent = '💡 ' + r.explain; exp.classList.add('show'); }
  });
}

function retakeQuiz(mi){
  delete quizState[mi];
  const item = FLAT.find(f=>f.type==='quiz'&&f.mi===mi);
  const k = keyFor(item);
  delete progress.quizScores[k];
  saveProgress(progress);
  const idx = FLAT.findIndex(f=>f.type==='quiz'&&f.mi===mi);
  renderQuiz(idx);
}

/* ============================================================
   المشروع النهائي
   ============================================================ */
async function renderProject(){
  const idx = FLAT.length-1;
  currentIndex = idx;
  setActiveNav(idx);
  const k = 'project';

  const wrap = document.getElementById('contentWrap');
  wrap.innerHTML = `<div class="callout">⏳ جارٍ التحميل…</div>`;

  let fp;
  try{
    fp = await api('/final-project');
  }catch(e){
    if(!e.unauthorized) renderError(e.message || 'تعذر تحميل المشروع. حاول مجدداً.');
    return;
  }
  const isDone = !!progress.done[k];
  let cardsHtml = '';
  fp.deliverables.forEach(d => {
    cardsHtml += `<div class="deliverable-card">
      <h4><span class="tag-icon">${d.icon}</span> ${d.name}</h4>
      <ul>${d.points.map(p=>`<li>${p}</li>`).join('')}</ul>
    </div>`;
  });
  wrap.innerHTML = `
    <div class="crumb">المشروع النهائي · ختامي · ${fp.time}</div>
    <div class="lesson-title">🎓 ${fp.title}</div>
    <p style="color:var(--ink-soft);max-width:620px;margin-bottom:30px;">${fp.desc}</p>
    ${cardsHtml}
    <div class="mark-row">
      <div class="mark-complete ${isDone?'done':''}" id="markBtn" onclick="toggleDone('project')">
        ${isDone?'✓ تم الإكمال':'وضع علامة إتمام المشروع'}
      </div>
    </div>
    <div class="lesson-nav">
      <button class="nav-btn" id="prevBtn">السابق ‹</button>
      <button class="nav-btn" onclick="renderHome()">العودة إلى الصفحة الرئيسية</button>
    </div>
  `;
  document.getElementById('prevBtn').onclick = () => goTo(idx-1);
  window.scrollTo(0,0);
  closeSidebar();
}

function wirePrevNext(idx){
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  if(prevBtn){
    prevBtn.disabled = idx<=0;
    prevBtn.onclick = () => { if(idx>0) goTo(idx-1); };
  }
  if(nextBtn){
    const isLast = idx>=FLAT.length-1;
    nextBtn.textContent = isLast ? '→ الانتقال إلى المشروع النهائي' : '› التالي';
    nextBtn.onclick = () => goTo(idx+1);
  }
  document.querySelectorAll('.nav-item').forEach(el=>{
    el.setAttribute('tabindex','0');
    el.setAttribute('role','button');
    el.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); el.click(); }};
  });
  document.querySelectorAll('.quiz-opt:not(.disabled)').forEach(el=>{
    el.setAttribute('tabindex','0');
    el.setAttribute('role','radio');
    el.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); el.click(); }};
  });
  document.querySelectorAll('.lq-opt:not(.disabled)').forEach(el=>{
    el.setAttribute('tabindex','0');
    el.setAttribute('role','radio');
    el.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); el.click(); }};
  });
}

function transitionTo(fn){
  const wrap = document.getElementById('contentWrap');
  wrap.classList.add('fade-out');
  setTimeout(()=>{
    wrap.classList.remove('fade-out');
    fn();
    wrap.classList.add('fade-in');
    setTimeout(()=>wrap.classList.remove('fade-in'),250);
  },180);
}

function goTo(idx){
  if(idx<0){ transitionTo(renderHome); return; }
  if(idx>=FLAT.length){ transitionTo(renderProject); return; }
  const item = FLAT[idx];
  if(item.type==='lesson') transitionTo(()=>renderLesson(idx));
  else if(item.type==='quiz') transitionTo(()=>renderQuiz(idx));
  else transitionTo(renderProject);
}

function openSidebar(){
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('overlay').classList.add('show');
}
function closeSidebar(){
  if(window.innerWidth>900) return;
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
}

/* ============================================================
   الإقلاع: يتحقق من وجود جلسة صالحة، ثم يجلب فقط "خريطة" الدورة
   (العناوين والأوقات) — لا يجلب أي درس أو إجابة إلا عند الطلب.
   ============================================================ */
async function boot(){
  if(!getToken()){ showLoginGate(); return; }
  const wrap = document.getElementById('contentWrap');
  wrap.innerHTML = `<div class="callout">⏳ جارٍ التحميل…</div>`;
  try{
    STRUCTURE = await api('/structure');
  }catch(e){
    if(e.unauthorized) return; // showLoginGate already triggered inside api()
    renderError(e.message || 'تعذر الاتصال بالخادم.');
    return;
  }
  buildFlat();
  buildNav();
  renderHome();
}

boot();
