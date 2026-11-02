const API='/api/ai';
const ACCOUNT_KEY='forgefocus-account-v1';
const $=s=>document.querySelector(s);
let faculty=null, facultyToken=sessionStorage.getItem('forgefocus-id-token')||'', syllabusText='', syllabusName='', currentCourse='', units=[], selectedUnit=null, providerReady={};
const loginScreen=$('#login-screen'), app=$('#app'), inputFile=$('#syllabus-file');

function localKey(){return `forgefocus-courses:${faculty?.sub||'guest'}`;}
function authHeaders(){return window.FORGEFOCUS_CONFIG?.hosted&&facultyToken?{Authorization:`Bearer ${facultyToken}`}:{ };}
function tokenIsFresh(token){try{const payload=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));return Number(payload.exp)*1000>Date.now()+30000;}catch{return false;}}
async function api(path,fields={}){
  const response=await fetch(`${API}/${path}`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',...authHeaders()},body:new URLSearchParams({...fields,profile:faculty?.sub||''})});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'The request failed.');return data;
}
async function getProviders(){
  try{providerReady=await (await fetch(`${API}/providers`,{headers:authHeaders()})).json();$('#server-status').classList.add('online');$('#provider-hint').textContent=providerReady.openai?`ChatGPT answers first${providerReady.gemini?' · Gemini backup and study visuals ready.':' · Add Gemini for backup answers and study visuals.'}`:providerReady.gemini?'OpenAI key missing; Gemini answers enabled as backup and makes study visuals.':'Add OpenAI or Gemini API keys in Render to enable AI.';}
  catch{providerReady={};$('#server-status').classList.remove('online');$('#provider-hint').textContent='Start the C++ server to connect AI providers.';}
  updateAnalyzeButton();
}
function updateAnalyzeButton(){
  const hasProvider=!!(providerReady.gemini||providerReady.openai);
  const ready=!!syllabusText&&!!$('#course-name').value.trim()&&hasProvider;
  $('#analyze-button').disabled=!ready;
  $('#ask-button').disabled=!syllabusText||!$('#question-input').value.trim()||!hasProvider;
  const visualButton=$('#visual-button');if(visualButton)visualButton.disabled=!syllabusText||!providerReady.gemini||!!visualButton.dataset.busy;
  const askStatus=$('#ask-status');
  if(askStatus&&!$('#ask-button').dataset.busy){
    if(!hasProvider){
      askStatus.textContent='Connect a Gemini or ChatGPT API key in Render to get syllabus answers.';
      askStatus.dataset.state='error';
    }else if(!['result','error'].includes(askStatus.dataset.state)){
      askStatus.textContent=selectedUnit?`Answers use ${selectedUnit.title||'the selected unit'} and its syllabus topics.`:'Answers are based on the uploaded syllabus.';
      askStatus.dataset.state='hint';
    }
  }
}
function showWorkspace(){loginScreen.hidden=true;app.hidden=false;$('#faculty-name').textContent=faculty.name;$('#avatar').textContent=(faculty.name||'F').trim().charAt(0).toUpperCase();$('#course-empty').hidden=false;getProviders();restoreCourse();renderCourseLibrary();}
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
  window.google.accounts.id.initialize({client_id:id,callback:parseCredential,auto_select:false});
  window.google.accounts.id.renderButton($('#google-button'),{type:'standard',theme:'outline',size:'large',shape:'rectangular',text:'signin_with',width:280});
}
try{faculty=JSON.parse(localStorage.getItem(ACCOUNT_KEY)||'null');}catch{faculty=null;}
if(window.FORGEFOCUS_CONFIG?.hosted&&(!faculty||!tokenIsFresh(facultyToken))){faculty=null;facultyToken='';sessionStorage.removeItem('forgefocus-id-token');localStorage.removeItem(ACCOUNT_KEY);}
if(window.FORGEFOCUS_CONFIG?.hosted)$('#settings-open').hidden=true;
if(faculty)showWorkspace();else initGoogle();

$('#sign-out').addEventListener('click',()=>{localStorage.removeItem(ACCOUNT_KEY);sessionStorage.removeItem('forgefocus-id-token');facultyToken='';faculty=null;app.hidden=true;loginScreen.hidden=false;if(window.google?.accounts?.id)window.google.accounts.id.disableAutoSelect();initGoogle();});
$('#settings-open').addEventListener('click',()=>$('#settings-dialog').showModal());
$('#settings-close').addEventListener('click',()=>$('#settings-dialog').close());
$('#provider-select').addEventListener('change',()=>{getProviders();});
$('#course-name').addEventListener('input',updateAnalyzeButton);
$('#question-input').addEventListener('input',updateAnalyzeButton);

async function extractPdf(file){
  if(!file||file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf'))throw new Error('Choose a PDF syllabus.');
  if(file.size>20*1024*1024)throw new Error('This PDF is over 20 MB. Please choose a smaller file.');
  $('#upload-message').textContent='Reading the PDF text…';
  const pdfjs=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.worker.min.mjs';
  const data=await file.arrayBuffer();const pdf=await pdfjs.getDocument({data}).promise;const pages=[];
  for(let i=1;i<=pdf.numPages;i++){
    const page=await pdf.getPage(i);const content=await page.getTextContent();pages.push(content.items.map(item=>item.str||'').join(' '));
  }
  const text=pages.join('\n');if(text.trim().length<80)throw new Error('This PDF has no selectable text. It may be scanned; OCR support is not set up yet.');
  syllabusText=text.slice(0,100000);syllabusName=file.name;$('#file-label').textContent=file.name;$('#file-subtitle').textContent=`${pdf.numPages} pages · ${(file.size/1024/1024).toFixed(1)} MB`;
  $('#upload-message').textContent=`Read ${pdf.numPages} pages. The PDF is processed in your browser; extracted text is sent to the AI you select only when you analyze or ask a question.`;
  if(!$('#course-name').value.trim())$('#course-name').value=file.name.replace(/\.pdf$/i,'').replace(/[_-]+/g,' ');
  updateAnalyzeButton();
}
inputFile.addEventListener('change',async()=>{try{await extractPdf(inputFile.files?.[0]);}catch(e){syllabusText='';$('#upload-message').textContent=e.message;updateAnalyzeButton();}});
const drop=$('#drop-zone');
drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragover');});
drop.addEventListener('dragleave',()=>drop.classList.remove('dragover'));
drop.addEventListener('drop',async e=>{e.preventDefault();drop.classList.remove('dragover');const f=e.dataTransfer.files?.[0];try{await extractPdf(f);}catch(err){syllabusText='';$('#upload-message').textContent=err.message;updateAnalyzeButton();}});
$('#replace-syllabus').addEventListener('click',()=>{window.scrollTo({top:0,behavior:'smooth'});inputFile.click();});

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
      currentCourse=course.title;syllabusText=course.syllabus||'';syllabusName=course.file||'';units=course.units||[];$('#course-name').value=course.title;renderUnits({course_title:course.title,course_summary:course.summary,units});$('#course-library').hidden=true;$('#course-workspace').hidden=false;$('#upload-section').hidden=false;$('#file-label').textContent=syllabusName||'Saved course loaded';$('#file-subtitle').textContent='Saved in this browser';$('#page-title').textContent='Syllabus studio';window.scrollTo({top:0,behavior:'smooth'});
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
  const output=$('#lesson-output');output.replaceChildren();const pre=document.createElement('pre');pre.className='lesson-result';pre.textContent=text;output.append(pre);$('#lesson-provider').textContent=provider||$('#provider-select').selectedOptions[0].textContent;
}
$('#visual-button').addEventListener('click',async()=>{
  const button=$('#visual-button');button.disabled=true;button.dataset.busy='1';$('#visual-status').textContent='Gemini is creating your study visual…';
  try{
    const result=await api('visual',{course:currentCourse,syllabus:syllabusText,unitTitle:selectedUnit?.title||'',topics:JSON.stringify(selectedUnit?.topics||[]),visualType:$('#visual-type').value});
    if(!result.image||!['image/png','image/jpeg','image/webp'].includes(result.mimeType))throw new Error('Gemini returned an unsupported image. Please try again.');
    const output=$('#lesson-output');output.replaceChildren();const image=document.createElement('img');image.className='study-visual';image.alt=`${$('#visual-type').value} for ${selectedUnit?.title||currentCourse}`;image.src=`data:${result.mimeType};base64,${result.image}`;output.append(image);
    const download=document.createElement('a');download.className='visual-download';download.href=image.src;download.download=`${currentCourse.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}-${$('#visual-type').value.replace(/\s+/g,'-')}.png`;download.textContent='Download study visual';output.append(download);
    $('#lesson-title').textContent=selectedUnit?.title||currentCourse;$('#lesson-provider').textContent='GEMINI VISUAL';$('#visual-status').textContent='Study visual ready. You can download it above.';
  }catch(error){$('#visual-status').textContent=error.message;}
  finally{delete button.dataset.busy;updateAnalyzeButton();}
});
async function callTutor(type,fields){
  const button=type==='ask'?$('#ask-button'):$('#analyze-button');button.disabled=true;button.dataset.busy='1';
  if(type==='ask'){
    $('#lesson-title').textContent='Syllabus question';
    showText('Reading the syllabus and preparing your answer…',$('#provider-select').selectedOptions[0].textContent);
    $('#ask-status').textContent='Working from the uploaded syllabus…';$('#ask-status').dataset.state='busy';
  }
  try{const result=await api(type,{provider:$('#provider-select').value,course:currentCourse,syllabus:syllabusText,...fields});
    if(type==='analyze'){
      const parsed=extractJson(result.text);currentCourse=$('#course-name').value.trim();renderUnits(parsed);persistCourse(parsed);showText(parsed.course_summary||'Course map generated. Select a unit to create a lesson.',result.provider);
    }else if(type==='teach'){showText(result.text,result.provider);$('#lesson-title').textContent=fields.unitTitle||'Lesson notes';}
    else {showText(result.text,result.provider);$('#lesson-title').textContent='Syllabus question';$('#question-input').value='';$('#ask-status').textContent=result.notice||'Answer prepared from the uploaded syllabus.';$('#ask-status').dataset.state='result';}
    $('#upload-message').textContent=result.notice|| (type==='analyze'?'Syllabus analysis complete. Review each unit and select Prepare this lesson.':'AI teaching material is ready.');
  }catch(error){
    if(type==='ask'){showText(`I couldn’t get an answer. ${error.message}`,'Needs attention');$('#lesson-title').textContent='Syllabus question';$('#ask-status').textContent='Please check the answer panel and try again.';$('#ask-status').dataset.state='error';}
    $('#upload-message').textContent=error.message;
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
$('#ask-button').addEventListener('click',()=>{const question=$('#question-input').value.trim();if(question&&syllabusText)callTutor('ask',{unitTitle:selectedUnit?.title||'',topics:JSON.stringify(selectedUnit?.topics||[]),question,wikipediaOptIn:$('#wiki-opt-in').checked?'yes':'no'});});
$('#question-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&!$('#ask-button').disabled){event.preventDefault();$('#ask-button').click();}});

$('#settings-form').addEventListener('submit',async e=>{
  e.preventDefault();const values={openai:$('#key-openai').value.trim(),gemini:$('#key-gemini').value.trim()};
  if(!Object.values(values).some(Boolean)){$('#settings-message').textContent='Enter at least one new API key before saving.';return;}
  const submit=e.submitter;submit.disabled=true;$('#settings-message').textContent='Saving keys on this device…';
  try{await api('keys',values);$('#settings-message').textContent='Saved. Keys are hidden after saving.';e.target.reset();await getProviders();setTimeout(()=>$('#settings-dialog').close(),700);}
  catch(error){$('#settings-message').textContent=error.message;}
  finally{submit.disabled=false;}
});

document.querySelectorAll('.nav-item').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('.nav-item').forEach(item=>item.classList.toggle('active',item===button));
  if(button.dataset.view==='courses'){ $('#page-title').textContent='My courses';$('#upload-section').hidden=true;$('#course-workspace').hidden=true;$('#course-empty').hidden=true;$('#course-library').hidden=false;renderCourseLibrary();window.scrollTo({top:0,behavior:'smooth'}); }
  else { $('#page-title').textContent='Syllabus studio';$('#upload-section').hidden=false;$('#course-library').hidden=true;$('#course-empty').hidden=!$('#course-workspace').hidden;window.scrollTo({top:0,behavior:'smooth'}); }
}));
$('#new-course').addEventListener('click',()=>{currentCourse='';syllabusText='';syllabusName='';units=[];selectedUnit=null;inputFile.value='';$('#course-name').value='';$('#file-label').textContent='Drop the syllabus PDF here';$('#file-subtitle').innerHTML='or <u>browse files</u> from your device';$('#course-workspace').hidden=true;$('#course-library').hidden=true;$('#upload-section').hidden=false;$('#course-empty').hidden=false;$('#page-title').textContent='Syllabus studio';document.querySelector('[data-view="studio"]').classList.add('active');document.querySelector('[data-view="courses"]').classList.remove('active');window.scrollTo({top:0,behavior:'smooth'});});
