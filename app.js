const API='/api/ai';
const ACCOUNT_KEY='forgefocus-account-v1';
const $=s=>document.querySelector(s);
let faculty=null, facultyToken=sessionStorage.getItem('forgefocus-id-token')||'', syllabusText='', syllabusName='', currentCourse='', units=[], selectedUnit=null, providerReady={}, syllabusRevision=0;
let currentPage='home', studioPageState={upload:false,workspace:true,empty:false};
const loginScreen=$('#login-screen'), app=$('#app'), inputFile=$('#syllabus-file');
const themeButtons=[...document.querySelectorAll('.theme-toggle')];
function setTheme(theme){
  const dark=theme==='dark';document.documentElement.dataset.theme=dark?'dark':'light';
  try{localStorage.setItem('forgefocus-theme',dark?'dark':'light');}catch{}
  themeButtons.forEach(button=>{button.setAttribute('aria-pressed',String(dark));button.setAttribute('aria-label',`Switch to ${dark?'light':'dark'} mode`);button.querySelector('.theme-icon').textContent=dark?'☀':'☾';button.querySelector('.theme-label').textContent=dark?'Light mode':'Dark mode';});
}
themeButtons.forEach(button=>button.addEventListener('click',()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark')));
setTheme(document.documentElement.dataset.theme==='dark'?'dark':'light');

function showPage(page){
  if(currentPage==='studio'){
    studioPageState={upload:!$('#upload-section').hidden,workspace:!$('#course-workspace').hidden,empty:!$('#course-empty').hidden};
  }
  currentPage=page;
  $('#landing-page').hidden=page!=='home';
  $('#syllabus-page').hidden=page==='home';
  document.querySelectorAll('.nav-item').forEach(item=>item.classList.toggle('active',item.dataset.view===page));
  if(page==='home'){
    $('#page-title').textContent='Home';
  }else if(page==='courses'){
    $('#page-title').textContent='My courses';
    $('#upload-section').hidden=true;$('#course-workspace').hidden=true;$('#course-empty').hidden=true;$('#course-library').hidden=false;
    renderCourseLibrary();
  }else{
    $('#page-title').textContent='Syllabus studio';
    $('#course-library').hidden=true;
    $('#upload-section').hidden=!studioPageState.upload;
    $('#course-workspace').hidden=!studioPageState.workspace;
    $('#course-empty').hidden=!studioPageState.empty;
  }
  window.scrollTo({top:0,behavior:'smooth'});
}

function localKey(){return `forgefocus-courses:${faculty?.sub||'guest'}`;}
function authHeaders(){return window.FORGEFOCUS_CONFIG?.hosted&&facultyToken?{Authorization:`Bearer ${facultyToken}`}:{ };}
function tokenIsFresh(token){try{const payload=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));return Number(payload.exp)*1000>Date.now()+30000;}catch{return false;}}
async function api(path,fields={}){
  const response=await fetch(`${API}/${path}`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',...authHeaders()},body:new URLSearchParams({...fields,profile:faculty?.sub||''})});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'The request failed.');return data;
}
function friendlyAiError(error){
  const message=String(error?.message||'').toLowerCase();
  if(/credit|quota|billing|rate.?limit|429|resource_exhausted|insufficient_quota/.test(message))return `An AI service reached its usage limit. Check its quota or try again later. Details: ${error.message}`;
  if(/rejected its api key|does not have access|invalid api key|unauthorized/.test(message))return 'The AI connection needs attention. Ask the faculty administrator to check the service key and access.';
  if(/not connected|add (gemini|openai)_api_key/.test(message))return 'No AI service is available right now. Ask the faculty administrator to connect an AI service.';
  if(/model is unavailable|selected ai model/.test(message))return 'The AI service needs a model configuration update. Ask the faculty administrator to check it.';
  if(/temporar|busy|overload|high demand|timed out|request failed/.test(message))return `The answer service is temporarily unavailable. Your syllabus is saved. Details: ${error.message}`;
  return error?.message||'The AI request could not be completed. Please try again.';
}
async function getProviders(){
  try{providerReady=await (await fetch(`${API}/providers`,{headers:authHeaders()})).json();$('#server-status').classList.add('online');$('#provider-hint').textContent=(providerReady.openai||providerReady.gemini)?'AI teaching is ready. Syllabus questions use the uploaded course content.':'AI setup is incomplete. Please contact the faculty administrator.';}
  catch{providerReady={};$('#server-status').classList.remove('online');$('#provider-hint').textContent='AI service is temporarily unavailable. Please refresh and try again.';}
  updateAnalyzeButton();
}
function updateAnalyzeButton(){
  const hasProvider=!!(providerReady.gemini||providerReady.openai);
  const ready=!!syllabusText&&!!$('#course-name').value.trim()&&hasProvider;
  $('#analyze-button').disabled=!ready;
  $('#ask-button').disabled=!syllabusText||!$('#question-input').value.trim()||!hasProvider;
  const generalQuestion=$('#general-question'),generalButton=$('#general-ask');
  if(generalQuestion&&generalButton)generalButton.disabled=!generalQuestion.value.trim()||!hasProvider||!!generalButton.dataset.busy;
  const visualButton=$('#visual-button');if(visualButton)visualButton.disabled=!syllabusText||!providerReady.gemini||!!visualButton.dataset.busy;
  const askStatus=$('#ask-status');
  if(askStatus&&!$('#ask-button').dataset.busy){
    if(!hasProvider){
      askStatus.textContent='AI service is not configured yet. Please contact the faculty administrator.';
      askStatus.dataset.state='error';
    }else if(!['result','error'].includes(askStatus.dataset.state)){
      askStatus.textContent=selectedUnit?`Answers use ${selectedUnit.title||'the selected unit'} and its syllabus topics.`:'Answers are based on the uploaded syllabus.';
      askStatus.dataset.state='hint';
    }
  }
}
function showWorkspace(){loginScreen.hidden=true;app.hidden=false;$('#faculty-name').textContent=faculty.name;$('#avatar').textContent=(faculty.name||'F').trim().charAt(0).toUpperCase();$('#account-email').textContent=faculty.email;$('#account-email').title=faculty.email;$('#account-avatar').textContent=(faculty.name||faculty.email||'F').trim().charAt(0).toUpperCase();$('#account-dialog-email').textContent=faculty.email;$('#course-empty').hidden=true;getProviders();restoreCourse();renderCourseLibrary();studioPageState={upload:true,workspace:!$('#course-workspace').hidden,empty:false};showPage('home');}
function parseCredential(response){
  try{
    const clientId=window.FORGEFOCUS_CONFIG?.googleClientId||'';
    const encoded=response.credential.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));const claims=JSON.parse(new TextDecoder().decode(bytes));
    if(!claims.sub||!claims.email||claims.email_verified!==true||claims.aud!==clientId||Number(claims.exp)*1000<Date.now())throw new Error('Google could not verify this account. Please sign in again.');
    facultyToken=response.credential;sessionStorage.setItem('forgefocus-id-token',facultyToken);faculty={sub:String(claims.sub),email:claims.email,name:claims.name||claims.given_name||claims.email};
    localStorage.setItem(ACCOUNT_KEY,JSON.stringify(faculty));$('#login-message').textContent=`Signed in as ${faculty.email}`;showWorkspace();
  }catch(error){$('#login-message').textContent=error.message||'Google sign-in failed. Please try again.';}
}
function initGoogle(){
  const id=window.FORGEFOCUS_CONFIG?.googleClientId||'';
  if(!id||id.startsWith('PASTE_')){$('#login-message').textContent='Add your Google Web Client ID to config.js before signing in.';return;}
  if(!window.google?.accounts?.id){const n=Number($('#google-button').dataset.wait||0)+1;$('#google-button').dataset.wait=String(n);if(n<30)setTimeout(initGoogle,200);else $('#login-message').textContent='Google sign-in could not load. Check the internet and reload.';return;}
  $('#google-button').replaceChildren();$('#google-button').dataset.wait='0';
  window.google.accounts.id.initialize({client_id:id,callback:parseCredential,auto_select:false});
  window.google.accounts.id.renderButton($('#google-button'),{type:'standard',theme:'outline',size:'large',shape:'rectangular',text:'signin_with',width:280});
}
try{faculty=JSON.parse(localStorage.getItem(ACCOUNT_KEY)||'null');}catch{faculty=null;}
if(window.FORGEFOCUS_CONFIG?.hosted&&(!faculty||!tokenIsFresh(facultyToken))){faculty=null;facultyToken='';sessionStorage.removeItem('forgefocus-id-token');localStorage.removeItem(ACCOUNT_KEY);}
if(window.FORGEFOCUS_CONFIG?.hosted)$('#settings-open').hidden=true;
if(faculty)showWorkspace();else initGoogle();

function endAccountSession(message){localStorage.removeItem(ACCOUNT_KEY);sessionStorage.removeItem('forgefocus-id-token');facultyToken='';faculty=null;app.hidden=true;loginScreen.hidden=false;$('#login-message').textContent=message;if(window.google?.accounts?.id)window.google.accounts.id.disableAutoSelect();initGoogle();}
$('#account-open').addEventListener('click',()=>{if(faculty){$('#account-message').textContent='';$('#account-dialog').showModal();}});
$('#account-close').addEventListener('click',()=>$('#account-dialog').close());
$('#switch-account').addEventListener('click',()=>{ $('#account-dialog').close();endAccountSession('Choose a Google account to continue. To use another one, select “Use another account” in Google’s sign-in window.'); });
$('#account-sign-out').addEventListener('click',()=>{ $('#account-dialog').close();endAccountSession('You are signed out. Sign in with Google to continue.'); });
$('#sign-out').addEventListener('click',()=>endAccountSession('You are signed out. Sign in with Google to continue.'));
$('#settings-open').addEventListener('click',()=>$('#settings-dialog').showModal());
$('#settings-close').addEventListener('click',()=>$('#settings-dialog').close());
$('#provider-select').addEventListener('change',()=>{getProviders();});
$('#course-name').addEventListener('input',updateAnalyzeButton);
$('#question-input').addEventListener('input',updateAnalyzeButton);
$('#general-question').addEventListener('input',updateAnalyzeButton);

function resetCourseForReplacement(){
  syllabusRevision++;syllabusText='';syllabusName='';currentCourse='';units=[];selectedUnit=null;
  $('#course-name').value='';$('#file-label').textContent='Drop the syllabus PDF here';$('#file-subtitle').innerHTML='or <u>browse files</u> from your device';$('#course-workspace').hidden=true;$('#course-empty').hidden=true;
  $('#sidebar-course-title').innerHTML='Upload a syllabus<br>to get started';$('#course-heading').textContent='';$('#analysis-summary').textContent='Review the syllabus units, then open a unit to prepare a lesson.';
  $('#unit-count').textContent='0 UNITS';$('#units-list').replaceChildren();
  const empty=document.createElement('div');empty.className='empty-state';empty.textContent='Upload a syllabus and analyze it to see its units here.';$('#units-list').append(empty);
  $('#lesson-title').textContent='Your lesson workspace';$('#lesson-provider').textContent='AI READY';
  $('#lesson-output').innerHTML='<div class="lesson-empty"><span>✦</span><h3>Choose a unit to begin</h3><p>ForgeFocus AI can prepare a lesson outline, simple explanation, real-world example, and quick check questions.</p></div>';
  $('#question-input').value='';$('#general-qa-answer').textContent='';$('#general-qa-answer').hidden=true;
  $('#ask-status').textContent='Answers use the syllabus for course questions and can explain broader education topics too.';$('#ask-status').dataset.state='hint';
  $('#upload-message').textContent='';updateAnalyzeButton();
  return syllabusRevision;
}
async function createOcrWorker(language){
  const sources=[
    {cdn:'https://cdn.jsdelivr.net/npm',langPath:`https://cdn.jsdelivr.net/npm/@tesseract.js-data/${language}/4.0.0_best_int`},
    {cdn:'https://unpkg.com',langPath:'https://tessdata.projectnaptha.com/4.0.0'}
  ];
  let lastError;
  for(const source of sources){
    try{
      const {createWorker}=await import(`${source.cdn}/tesseract.js@5.1.1/dist/tesseract.esm.min.js`);
      return await createWorker(language,1,{
        workerPath:`${source.cdn}/tesseract.js@5.1.1/dist/worker.min.js`,
        corePath:`${source.cdn}/tesseract.js-core@5.1.0`,
        langPath:source.langPath
      });
    }catch(error){lastError=error;}
  }
  throw lastError||new Error('OCR engine could not be started.');
}
async function extractPdf(file,revision){
  if(!file||file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf'))throw new Error('Choose a PDF syllabus.');
  if(file.size>20*1024*1024)throw new Error('This PDF is over 20 MB. Please choose a smaller file.');
  if(revision!==syllabusRevision)return;
  $('#upload-message').textContent='Reading the PDF…';
  const pdfjs=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.worker.min.mjs';
  const data=await file.arrayBuffer();const pdf=await pdfjs.getDocument({data}).promise;const pages=[];let ocrWorker=null;
  for(let i=1;i<=pdf.numPages;i++){
    if(revision!==syllabusRevision)return;
    const page=await pdf.getPage(i);const content=await page.getTextContent();let pageText=content.items.map(item=>item.str||'').join(' ').trim();
    if(pageText.length<30){
      try{
        if(!ocrWorker){const language=$('#ocr-language').value||'eng';$('#upload-message').textContent=`Scanned pages detected. Loading ${$('#ocr-language').selectedOptions[0]?.textContent||'English'} OCR…`;ocrWorker=await createOcrWorker(language);}
        if(revision!==syllabusRevision){await ocrWorker.terminate();return;}
        $('#upload-message').textContent=`Reading scanned page ${i} of ${pdf.numPages}…`;
        const viewport=page.getViewport({scale:2});const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const context=canvas.getContext('2d',{willReadFrequently:true});context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);await page.render({canvas,canvasContext:context,viewport}).promise;
        pageText=(await ocrWorker.recognize(canvas)).data.text.trim();canvas.width=0;canvas.height=0;
      }catch(error){if(ocrWorker){await ocrWorker.terminate().catch(()=>{});ocrWorker=null;}if(!pageText){const detail=String(error?.message||error||'OCR engine failed').replace(/\s+/g,' ').slice(0,180);throw new Error(`Could not read scanned page ${i}. Check your connection to the OCR service and confirm the scanned PDF language is selected correctly. ${detail}`);}}
    }
    pages.push(pageText);
  }
  if(ocrWorker)await ocrWorker.terminate();
  if(revision!==syllabusRevision)return;
  const text=pages.join('\n');if(text.trim().length<80)throw new Error('Not enough readable text was found. Try a clearer scan or a text-based PDF.');
  syllabusText=text.slice(0,100000);syllabusName=file.name;$('#file-label').textContent=file.name;$('#file-subtitle').textContent=`${pdf.numPages} pages · ${(file.size/1024/1024).toFixed(1)} MB`;
  $('#upload-message').textContent=`Read ${pdf.numPages} pages${pages.some(t=>t.length<30)?` with ${$('#ocr-language').selectedOptions[0]?.textContent||'English'} OCR for scanned pages`:''}. PDF text is processed in your browser and sent to the AI only when you analyze or ask a question.`;
  $('#course-name').value=file.name.replace(/\.pdf$/i,'').replace(/[_-]+/g,' ');
  updateAnalyzeButton();
}
inputFile.addEventListener('change',async()=>{const file=inputFile.files?.[0];if(!file)return;inputFile.value='';const revision=resetCourseForReplacement();try{await extractPdf(file,revision);}catch(e){if(revision!==syllabusRevision)return;syllabusText='';$('#upload-message').textContent=e.message;updateAnalyzeButton();}});
const drop=$('#drop-zone');
drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragover');});
drop.addEventListener('dragleave',()=>drop.classList.remove('dragover'));
drop.addEventListener('drop',async e=>{e.preventDefault();drop.classList.remove('dragover');const f=e.dataTransfer.files?.[0];if(!f)return;const revision=resetCourseForReplacement();inputFile.value='';try{await extractPdf(f,revision);}catch(err){if(revision!==syllabusRevision)return;syllabusText='';$('#upload-message').textContent=err.message;updateAnalyzeButton();}});
$('#replace-syllabus').addEventListener('click',()=>{window.scrollTo({top:0,behavior:'smooth'});inputFile.value='';inputFile.click();});

function extractJson(text){
  const clean=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  const first=clean.indexOf('{'),last=clean.lastIndexOf('}');if(first<0||last<first)throw new Error('AI response did not contain a course map. Try Analyze again.');
  return JSON.parse(clean.slice(first,last+1));
}
function renderUnits(parsed){
  units=Array.isArray(parsed.units)?parsed.units:[];selectedUnit=null;$('#course-heading').textContent=parsed.course_title||currentCourse;$('#analysis-summary').textContent=parsed.course_summary||`${units.length} syllabus units identified. Select a unit to prepare teaching material.`;$('#unit-count').textContent=`${units.length} UNIT${units.length===1?'':'S'}`;$('#sidebar-course-title').textContent=parsed.course_title||currentCourse;
  const list=$('#units-list');list.replaceChildren();
  units.forEach((unit,index)=>{
    const card=document.createElement('article');card.className='unit-card';
    const top=document.createElement('div');top.className='unit-top';const title=document.createElement('span');title.className='unit-title';title.textContent=unit.title||`Unit ${index+1}`;const meta=document.createElement('span');meta.className='unit-meta';meta.textContent=`UNIT ${String(index+1).padStart(2,'0')}`;top.append(title,meta);
    const topics=document.createElement('p');topics.className='unit-topics';topics.textContent=(Array.isArray(unit.topics)?unit.topics:[]).join(' · ')||unit.description||'Topics identified from your uploaded syllabus.';
    const teach=document.createElement('button');teach.type='button';teach.className='teach-button';teach.textContent='Prepare this lesson →';teach.addEventListener('click',()=>teachUnit(index));
    card.addEventListener('click',()=>selectUnit(index));card.append(top,topics,teach);list.append(card);
  });
  $('#course-workspace').hidden=false;$('#course-empty').hidden=true;
}
function persistCourse(parsed){
  if(!faculty)return;
  const courses=JSON.parse(localStorage.getItem(localKey())||'[]');
  const saved={title:parsed.course_title||currentCourse,summary:parsed.course_summary||'',units,syllabus:syllabusText,file:syllabusName,savedAt:Date.now()};
  const next=[saved,...courses.filter(c=>c.title!==saved.title)].slice(0,8);localStorage.setItem(localKey(),JSON.stringify(next));renderCourseLibrary();
  $('#sidebar-course-title').textContent=saved.title;
}
function renderCourseLibrary(){
  const list=$('#course-list');if(!list||!faculty)return;list.replaceChildren();
  let courses=[];try{courses=JSON.parse(localStorage.getItem(localKey())||'[]');}catch{}
  if(!courses.length){const empty=document.createElement('div');empty.className='library-empty card';empty.textContent='No saved courses yet. Upload a syllabus PDF in Syllabus studio.';list.append(empty);return;}
  courses.forEach(course=>{const card=document.createElement('button');card.type='button';card.className='library-card card';const title=document.createElement('strong');title.textContent=course.title;const detail=document.createElement('span');detail.textContent=`${course.units?.length||0} units · ${course.file||'Syllabus PDF'}`;const open=document.createElement('b');open.textContent='OPEN COURSE →';card.append(title,detail,open);card.addEventListener('click',()=>{
      currentCourse=course.title;syllabusText=course.syllabus||'';syllabusName=course.file||'';units=course.units||[];$('#course-name').value=course.title;renderUnits({course_title:course.title,course_summary:course.summary,units});$('#course-library').hidden=true;$('#course-workspace').hidden=false;$('#upload-section').hidden=false;$('#course-empty').hidden=true;$('#file-label').textContent=syllabusName||'Saved course loaded';$('#file-subtitle').textContent='Saved in this browser';studioPageState={upload:true,workspace:true,empty:false};showPage('studio');
    });list.append(card);});
}
function restoreCourse(){
  if(!faculty)return;
  try{const courses=JSON.parse(localStorage.getItem(localKey())||'[]');const saved=courses[0];if(!saved)return;
    currentCourse=saved.title;syllabusText=saved.syllabus||'';syllabusName=saved.file||'';units=saved.units||[];$('#course-name').value=currentCourse;$('#file-label').textContent=syllabusName||'Saved course loaded';$('#file-subtitle').textContent='Saved in this browser';
    renderUnits({course_title:saved.title,course_summary:saved.summary,units});$('#course-empty').hidden=true;
  }catch{localStorage.removeItem(localKey());}
}
function showText(text,provider){
  const output=$('#lesson-output');output.replaceChildren();const article=renderAnswer(text);article.className='lesson-result';output.append(article);$('#lesson-provider').textContent='AI';
}
function renderAnswer(markdown){
  const root=document.createElement('div');
  const inline=(parent,value)=>{const re=/(\*\*|__)(.+?)\1|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;let at=0,m;while((m=re.exec(value))){parent.append(document.createTextNode(value.slice(at,m.index)));if(m[3]){const code=document.createElement('code');code.textContent=m[3];parent.append(code);}else if(m[4]){const a=document.createElement('a');a.textContent=m[4];a.href=m[5];a.target='_blank';a.rel='noopener noreferrer';parent.append(a);}else{const strong=document.createElement('strong');strong.textContent=m[2];parent.append(strong);}at=re.lastIndex;}parent.append(document.createTextNode(value.slice(at)));};
  const lines=String(markdown||'').replace(/\\n/g,'\n').split(/\r?\n/);let list=null,table=null,paragraph=[];
  const flush=()=>{if(paragraph.length){const p=document.createElement('p');inline(p,paragraph.join(' '));root.append(p);paragraph=[];}};
  for(let i=0;i<lines.length;i++){const line=lines[i].trim();if(line.startsWith('```')){flush();list=null;const language=line.slice(3).trim().toLowerCase(),codeLines=[];while(i+1<lines.length&&!lines[i+1].trim().startsWith('```'))codeLines.push(lines[++i]);if(i+1<lines.length)i++;const pre=document.createElement('pre');pre.className=language==='mermaid'?'mermaid-study-diagram':'answer-code';pre.textContent=codeLines.join('\n');root.append(pre);continue;}if(!line){flush();list=null;continue;}if(/^\|.*\|$/.test(line)){flush();const cells=s=>s.trim().replace(/^\||\|$/g,'').split('|').map(x=>x.trim());if(/^[|\s:–-]+$/.test(line))continue;if(!table){table=document.createElement('table');const thead=document.createElement('thead'),tr=document.createElement('tr');cells(line).forEach(c=>{const th=document.createElement('th');inline(th,c);tr.append(th);});thead.append(tr);table.append(thead,document.createElement('tbody'));root.append(table);}else{const tr=document.createElement('tr');cells(line).forEach(c=>{const td=document.createElement('td');inline(td,c);tr.append(td);});table.tBodies[0].append(tr);}continue;}table=null;
    const h=line.match(/^(#{1,4})\s+(.+)$/);if(h){flush();list=null;const el=document.createElement(h[1].length<=2?'h3':'h4');inline(el,h[2].replace(/\s+#+$/,''));root.append(el);continue;}if(/^[-*_]{3,}$/.test(line)){flush();list=null;root.append(document.createElement('hr'));continue;}
    const item=line.match(/^\s*(?:[-*+]\s+|(\d+)[.)]\s+)(.+)$/);if(item){flush();const ordered=!!item[1];if(!list||list.tagName!==(ordered?'OL':'UL')){list=document.createElement(ordered?'ol':'ul');root.append(list);}const li=document.createElement('li');inline(li,item[2]);list.append(li);continue;}list=null;paragraph.push(line);
  }flush();return root;
}
let mermaidPromise=null,mermaidInitialized=false,diagramCounter=0;
async function renderStudyDiagrams(container){
  const nodes=[...container.querySelectorAll('.mermaid-study-diagram')];if(!nodes.length)return;
  try{
    if(!mermaidPromise)mermaidPromise=import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs').then(module=>module.default);
    const mermaid=await mermaidPromise;if(!mermaidInitialized){mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'neutral'});mermaidInitialized=true;}
    for(const node of nodes){try{const {svg}=await mermaid.render(`forgefocus-diagram-${++diagramCounter}`,node.textContent);const wrapper=document.createElement('div');wrapper.className='study-diagram';wrapper.innerHTML=svg;node.replaceWith(wrapper);}catch{node.classList.add('diagram-fallback');node.setAttribute('aria-label','Diagram code could not be rendered; readable source shown below.');}}
  }catch{nodes.forEach(node=>node.classList.add('diagram-fallback'));}
}
let pdfLibraryPromise=null;
function loadPdfLibrary(){
  if(window.html2pdf)return Promise.resolve(window.html2pdf);
  if(!pdfLibraryPromise)pdfLibraryPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src='https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';script.async=true;
    script.onload=()=>window.html2pdf?resolve(window.html2pdf):reject(new Error('PDF tool did not load.'));
    script.onerror=()=>reject(new Error('PDF tool could not load. Check your internet connection and try again.'));
    document.head.append(script);
  }).catch(error=>{pdfLibraryPromise=null;throw error;});
  return pdfLibraryPromise;
}
function safeFileName(value){return String(value||'study-answer').normalize('NFKD').replace(/[^\w.-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,70)||'study-answer';}
async function downloadAnswerPdf(content,title,button){
  const original=button?.textContent;
  if(button){button.disabled=true;button.textContent='Preparing PDF…';}
  try{
    const html2pdf=await loadPdfLibrary();const page=document.createElement('article');page.className='pdf-export';
    const heading=document.createElement('h1');heading.textContent=title||currentCourse||'Study answer';page.append(heading);
    if(currentCourse){const course=document.createElement('p');course.className='pdf-course';course.textContent=currentCourse;page.append(course);}
    const body=content.cloneNode(true);body.querySelectorAll('.answer-tools').forEach(node=>node.remove());page.append(body);document.body.append(page);
    try{await html2pdf().set({margin:[14,14,16,14],filename:`${safeFileName(title||currentCourse)}.pdf`,image:{type:'jpeg',quality:.96},html2canvas:{scale:2,useCORS:true,backgroundColor:'#ffffff',logging:false},jsPDF:{unit:'mm',format:'a4',orientation:'portrait'},pagebreak:{mode:['css','legacy']}}).from(page).save();}
    finally{page.remove();}
    return true;
  }catch(error){const status=content.closest('.general-qa')?.querySelector('#general-qa-status')||$('#ask-status');if(status)status.textContent='Answer is ready. PDF download failed; check your connection and tap Download as PDF to retry.';return false;}
  finally{if(button){button.disabled=false;button.textContent=original||'Download as PDF';}}
}
function pdfWasRequested(question){const text=String(question||'');return /\b(?:as\s+(?:a\s+)?pdf|in\s+pdf|pdf\s*(?:format|file|version|please|ah+|a|la|venum|kudu|thaa)\b|(?:make|create|generate|download|export|give|send|save)\b.{0,35}\bpdf\b|\bpdf\b.{0,40}\b(?:make|create|generate|download|export|give|send|save|venum|kudu|thaa)\b)/i.test(text);}
const VIDEO_LANGUAGES={
  auto:{label:'Auto from question',code:'',hint:''},
  en:{label:'English',code:'en',hint:'in English'},ta:{label:'தமிழ் · Tamil',code:'ta',hint:'தமிழில்'},hi:{label:'हिन्दी · Hindi',code:'hi',hint:'हिंदी में'},
  te:{label:'తెలుగు · Telugu',code:'te',hint:'తెలుగులో'},kn:{label:'ಕನ್ನಡ · Kannada',code:'kn',hint:'ಕನ್ನಡದಲ್ಲಿ'},ml:{label:'മലയാളം · Malayalam',code:'ml',hint:'മലയാളത്തിൽ'},
  bn:{label:'বাংলা · Bengali',code:'bn',hint:'বাংলায়'},mr:{label:'मराठी · Marathi',code:'mr',hint:'मराठीत'},gu:{label:'ગુજરાતી · Gujarati',code:'gu',hint:'ગુજરાતીમાં'},pa:{label:'ਪੰਜਾਬੀ · Punjabi',code:'pa',hint:'ਪੰਜਾਬੀ ਵਿੱਚ'},ur:{label:'اردو · Urdu',code:'ur',hint:'اردو میں'},
  es:{label:'Español · Spanish',code:'es',hint:'en español'},fr:{label:'Français · French',code:'fr',hint:'en français'},pt:{label:'Português · Portuguese',code:'pt',hint:'em português'},
  ar:{label:'العربية · Arabic',code:'ar',hint:'بالعربية'},zh:{label:'中文 · Chinese',code:'zh',hint:'中文'},ja:{label:'日本語 · Japanese',code:'ja',hint:'日本語で'},ko:{label:'한국어 · Korean',code:'ko',hint:'한국어로'},
  de:{label:'Deutsch · German',code:'de',hint:'auf Deutsch'},it:{label:'Italiano · Italian',code:'it',hint:'in italiano'},id:{label:'Bahasa Indonesia',code:'id',hint:'dalam bahasa Indonesia'},
  th:{label:'ไทย · Thai',code:'th',hint:'ภาษาไทย'},vi:{label:'Tiếng Việt · Vietnamese',code:'vi',hint:'bằng tiếng Việt'},tr:{label:'Türkçe · Turkish',code:'tr',hint:'Türkçe'},ru:{label:'Русский · Russian',code:'ru',hint:'на русском'}
};
const ANSWER_LANGUAGES=[['auto','Auto — match my question'],['en','English'],['ta','தமிழ் · Tamil'],['hi','हिन्दी · Hindi'],['te','తెలుగు · Telugu'],['kn','ಕನ್ನಡ · Kannada'],['ml','മലയാളം · Malayalam'],['bn','বাংলা · Bengali'],['mr','मराठी · Marathi'],['gu','ગુજરાતી · Gujarati'],['pa','ਪੰਜਾਬੀ · Punjabi'],['ur','اردو · Urdu'],['ar','العربية · Arabic'],['fr','Français · French'],['es','Español · Spanish'],['pt','Português · Portuguese']];
for(const selector of ['#general-answer-language','#question-answer-language']){
  const select=$(selector);ANSWER_LANGUAGES.forEach(([code,label])=>{const option=document.createElement('option');option.value=code;option.textContent=label;select.append(option);});
}
function detectVideoLanguage(question){
  const text=String(question||'');
  const explicit=text.match(/\b(?:in|using|speak|answer|explain|video in)\s+(tamil|tanglish|hindi|telugu|kannada|malayalam|bengali|bangla|marathi|gujarati|punjabi|urdu|spanish|espanol|french|francais|portuguese|portugues|arabic|chinese|mandarin|japanese|korean|german|italian|indonesian|thai|vietnamese|turkish|russian|english)\b|\b(tamil|tanglish|hindi|telugu|kannada|malayalam|bengali|bangla|marathi|gujarati|punjabi|urdu|spanish|espanol|french|francais|portuguese|portugues|arabic|chinese|mandarin|japanese|korean|german|italian|indonesian|thai|vietnamese|turkish|russian)\s*(?:la|ல|language)\b/i);
  const name=(explicit?.[1]||explicit?.[2]||'').toLowerCase();
  const aliases={tanglish:'ta',bangla:'bn',espanol:'es',francais:'fr',portugues:'pt',mandarin:'zh',indonesian:'id'};
  if(name)return aliases[name]||Object.keys(VIDEO_LANGUAGES).find(code=>code!=='auto'&&VIDEO_LANGUAGES[code].label.toLowerCase().includes(name))||'auto';
  const scripts=[
    ['ta',/[\u0B80-\u0BFF]/],['te',/[\u0C00-\u0C7F]/],['kn',/[\u0C80-\u0CFF]/],['ml',/[\u0D00-\u0D7F]/],
    ['bn',/[\u0980-\u09FF]/],['pa',/[\u0A00-\u0A7F]/],['gu',/[\u0A80-\u0AFF]/],['hi',/[\u0900-\u097F]/],['ur',/[\u0750-\u077F]|[ٹڈڑںھۂےۓ]/],['ar',/[\u0600-\u06FF]/],
    ['ja',/[\u3040-\u30FF]/],['ko',/[\uAC00-\uD7AF]/],['zh',/[\u3400-\u9FFF]/]
  ];
  return scripts.find(([,pattern])=>pattern.test(text))?.[0]||'auto';
}
function addAnswerTools(content,{title,question='',context='',autoPdf=false,answerLanguage='auto'}={}){
  const tools=document.createElement('section');tools.className='answer-tools';
  const heading=document.createElement('h4');heading.textContent='YouTube video suggestions';tools.append(heading);
  const originalQuestion=String(question||context||title||'').trim(),cleanContext=String(context||currentCourse||'').trim();
  const languageRow=document.createElement('label');languageRow.className='video-language-row';languageRow.append(document.createTextNode('Video language '));
  const languageSelect=document.createElement('select');languageSelect.className='video-language-select';languageSelect.setAttribute('aria-label','Choose suggested video language');
  Object.entries(VIDEO_LANGUAGES).forEach(([code,language])=>{const option=document.createElement('option');option.value=code;option.textContent=language.label;languageSelect.append(option);});
  languageSelect.value=VIDEO_LANGUAGES[answerLanguage]?.code?answerLanguage:detectVideoLanguage(question||context);languageRow.append(languageSelect);tools.append(languageRow);
  const links=document.createElement('div');links.className='video-suggestions';
  const renderVideoLinks=()=>{
    const language=VIDEO_LANGUAGES[languageSelect.value]||VIDEO_LANGUAGES.auto;
    const base=originalQuestion||cleanContext||'education';
    const queries=[{label:base,query:base}];
    if(languageSelect.value!=='auto'&&language.hint)queries.push({label:`${base} · ${language.label}`,query:`${base} ${language.hint}`});
    if(cleanContext&&question)queries.push({label:`${cleanContext} · ${String(question).slice(0,60)}`,query:`${cleanContext} ${question}${languageSelect.value!=='auto'&&language.hint?` ${language.hint}`:''}`});
    if(queries.length<2&&cleanContext&&cleanContext!==base)queries.push({label:cleanContext,query:cleanContext});
    const unique=queries.filter((item,index,list)=>list.findIndex(other=>other.query.toLowerCase()===item.query.toLowerCase())===index).slice(0,3);links.replaceChildren();
    unique.forEach(item=>{const link=document.createElement('a');const url=new URL('https://www.youtube.com/results');url.searchParams.set('search_query',item.query);if(language.code)url.searchParams.set('hl',language.code);link.href=url.toString();link.target='_blank';link.rel='noopener noreferrer';link.textContent=`▶ ${item.label.length>85?`${item.label.slice(0,82)}…`:item.label}`;link.title=`Search YouTube in ${language.label}: ${item.query}`;links.append(link);});
  };
  languageSelect.addEventListener('change',renderVideoLinks);renderVideoLinks();tools.append(links);
  const download=document.createElement('button');download.type='button';download.className='answer-pdf-button';download.textContent='↓ Download as PDF';download.addEventListener('click',()=>downloadAnswerPdf(content,title,download));tools.append(download);
  const layout=document.createElement('div');layout.className='answer-with-resources';const answerBody=document.createElement('div');answerBody.className='answer-main';while(content.firstChild)answerBody.append(content.firstChild);layout.append(answerBody,tools);content.append(layout);renderStudyDiagrams(answerBody);
  if(autoPdf)setTimeout(()=>downloadAnswerPdf(content,title,download),0);
}
$('#visual-button').addEventListener('click',async()=>{
  const button=$('#visual-button');button.disabled=true;button.dataset.busy='1';$('#visual-status').textContent='Creating your study visual…';
  try{
    const result=await api('visual',{course:currentCourse,syllabus:syllabusText,unitTitle:selectedUnit?.title||'',topics:JSON.stringify(selectedUnit?.topics||[]),visualType:$('#visual-type').value});
    if(!result.image||!['image/png','image/jpeg','image/webp'].includes(result.mimeType))throw new Error('The study visual could not be created. Please try again.');
    const output=$('#lesson-output');output.replaceChildren();const image=document.createElement('img');image.className='study-visual';image.alt=`${$('#visual-type').value} for ${selectedUnit?.title||currentCourse}`;image.src=`data:${result.mimeType};base64,${result.image}`;output.append(image);
    const download=document.createElement('a');download.className='visual-download';download.href=image.src;download.download=`${currentCourse.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}-${$('#visual-type').value.replace(/\s+/g,'-')}.png`;download.textContent='Download study visual';output.append(download);
    $('#lesson-title').textContent=selectedUnit?.title||currentCourse;$('#lesson-provider').textContent='AI';$('#visual-status').textContent='Study visual ready. You can download it above.';
  }catch(error){$('#visual-status').textContent=friendlyAiError(error);}
  finally{delete button.dataset.busy;updateAnalyzeButton();}
});
async function callTutor(type,fields){
  const button=type==='ask'?$('#ask-button'):$('#analyze-button');button.disabled=true;button.dataset.busy='1';
  const requestRevision=syllabusRevision;
  if(type==='analyze')$('#upload-message').textContent='Analyzing the syllabus and mapping its units… This step is limited to about 35 seconds.';
  if(type==='ask'){
    $('#lesson-title').textContent='Syllabus question';
    showText('Reading the syllabus and preparing your answer…','AI');
    $('#ask-status').textContent='Working from the uploaded syllabus…';$('#ask-status').dataset.state='busy';
  }
  try{const result=await api(type,{provider:$('#provider-select').value,course:currentCourse,syllabus:syllabusText,...fields});
    if(requestRevision!==syllabusRevision)return;
    if(type==='analyze'){
      const parsed=extractJson(result.text);currentCourse=$('#course-name').value.trim();renderUnits(parsed);persistCourse(parsed);showText(parsed.course_summary||'Course map generated. Select a unit to create a lesson.',result.provider);
    }else if(type==='teach'){showText(result.text,result.provider);$('#lesson-title').textContent=fields.unitTitle||'Lesson notes';addAnswerTools($('#lesson-output .lesson-result'),{title:fields.unitTitle||'Lesson notes',context:fields.unitTitle||currentCourse});}
    else {showText(result.text,result.provider);$('#lesson-title').textContent='Syllabus question';addAnswerTools($('#lesson-output .lesson-result'),{title:fields.unitTitle||currentCourse||'Syllabus answer',question:fields.question,context:[currentCourse,fields.unitTitle].filter(Boolean).join(' · '),autoPdf:pdfWasRequested(fields.question),answerLanguage:fields.answerLanguage});$('#question-input').value='';$('#ask-status').textContent=result.notice||'Answer prepared from the uploaded syllabus.';$('#ask-status').dataset.state='result';}
    $('#upload-message').textContent=result.notice|| (type==='analyze'?'Syllabus analysis complete. Review each unit and select Prepare this lesson.':'AI teaching material is ready.');
  }catch(error){
    if(requestRevision!==syllabusRevision)return;
    const safeError=friendlyAiError(error);
    if(type==='ask'){showText(safeError,'AI');$('#lesson-title').textContent='Syllabus question';$('#ask-status').textContent=safeError;$('#ask-status').dataset.state='error';}
    $('#upload-message').textContent=safeError;
  }
  finally{delete button.dataset.busy;updateAnalyzeButton();}
}
$('#analyze-button').addEventListener('click',()=>{currentCourse=$('#course-name').value.trim();callTutor('analyze',{});});
async function teachUnit(index){
  selectUnit(index);
  $('#lesson-title').textContent=selectedUnit.title||`Unit ${index+1}`;
  await callTutor('teach',{unitTitle:selectedUnit.title||`Unit ${index+1}`,topics:JSON.stringify(selectedUnit.topics||[])});
}
function selectUnit(index){
  selectedUnit=units[index];if(!selectedUnit)return;
  document.querySelectorAll('.unit-card').forEach((el,i)=>el.classList.toggle('selected',i===index));
  $('#ask-status').textContent=`Questions will focus on ${selectedUnit.title||`Unit ${index+1}`} and its listed syllabus topics.`;
  $('#ask-status').dataset.state='hint';updateAnalyzeButton();
}
$('#ask-button').addEventListener('click',()=>{const question=$('#question-input').value.trim();if(question&&syllabusText)callTutor('ask',{unitTitle:selectedUnit?.title||'',topics:JSON.stringify(selectedUnit?.topics||[]),question,answerLanguage:$('#question-answer-language').value,wikipediaOptIn:$('#wiki-opt-in').checked?'yes':'no'});});
$('#question-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&!$('#ask-button').disabled){event.preventDefault();$('#ask-button').click();}});

async function askGeneralEducation(){
  const question=$('#general-question').value.trim(),button=$('#general-ask'),answer=$('#general-qa-answer'),status=$('#general-qa-status');
  if(!question||button.disabled)return;
  button.disabled=true;button.dataset.busy='1';answer.hidden=true;status.textContent='Preparing an educational answer…';
  try{
    const answerLanguage=$('#general-answer-language').value;
    const result=await api('ask',{course:currentCourse||$('#course-name').value.trim()||'General education',syllabus:syllabusText,unitTitle:'',topics:'',question,answerLanguage,wikipediaOptIn:'no'});
    answer.replaceChildren(renderAnswer(result.text));answer.hidden=false;addAnswerTools(answer,{title:currentCourse||'Study answer',question,context:currentCourse||'General education',autoPdf:pdfWasRequested(question),answerLanguage});status.textContent=result.notice||'Answer ready.';$('#general-question').value='';
  }catch(error){
    status.textContent=friendlyAiError(error);
  }finally{delete button.dataset.busy;updateAnalyzeButton();}
}
$('#general-ask').addEventListener('click',askGeneralEducation);
$('#general-question').addEventListener('keydown',event=>{if(event.key==='Enter'&&!$('#general-ask').disabled){event.preventDefault();askGeneralEducation();}});

$('#settings-form').addEventListener('submit',async e=>{
  e.preventDefault();const values={openai:$('#key-openai').value.trim(),gemini:$('#key-gemini').value.trim()};
  if(!Object.values(values).some(Boolean)){$('#settings-message').textContent='Enter at least one new API key before saving.';return;}
  const submit=e.submitter;submit.disabled=true;$('#settings-message').textContent='Saving keys on this device…';
  try{await api('keys',values);$('#settings-message').textContent='Saved. Keys are hidden after saving.';e.target.reset();await getProviders();setTimeout(()=>$('#settings-dialog').close(),700);}
  catch(error){$('#settings-message').textContent=error.message;}
  finally{submit.disabled=false;}
});

document.querySelectorAll('.nav-item').forEach(button=>button.addEventListener('click',()=>showPage(button.dataset.view)));
document.querySelector('[data-page="studio"]')?.addEventListener('click',event=>{event.preventDefault();showPage('studio');});
$('#new-course').addEventListener('click',()=>{currentCourse='';syllabusText='';syllabusName='';units=[];selectedUnit=null;inputFile.value='';$('#course-name').value='';$('#file-label').textContent='Drop the syllabus PDF here';$('#file-subtitle').innerHTML='or <u>browse files</u> from your device';$('#course-workspace').hidden=true;$('#course-library').hidden=true;$('#upload-section').hidden=false;$('#course-empty').hidden=true;studioPageState={upload:true,workspace:false,empty:false};showPage('studio');});
