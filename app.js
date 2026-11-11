const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const CATS=['Çalışma','Öğrenme','Kişisel','Sosyal','Dinlenme','Uyku','Ev işleri','Diğer'];
const COLORS={'Çalışma':'#b8a5df','Öğrenme':'#e8b5d0','Kişisel':'#f1d2b5','Sosyal':'#c6d9c9','Dinlenme':'#d7c5e9','Uyku':'#aeb9d9','Ev işleri':'#e9c5a9','Diğer':'#d8cbd8'};
const todayISO=()=>{let d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const dateObj=s=>new Date(s+'T12:00:00');
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const fmtDate=s=>dateObj(s).toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric'});
const fmtDur=m=>`${Math.floor(m/60)} sa ${m%60} dk`;
let selectedDate=todayISO(),calendarDate=dateObj(todayISO()),calendarMode='month',analysisRange='day';
let data=JSON.parse(localStorage.getItem('tg-data')||'{"activities":[],"pages":{},"theme":"pearl"}');
if(!data.activities)data.activities=[];if(!data.pages)data.pages={};if(!data.stickerCollections)data.stickerCollections={};
const save=()=>localStorage.setItem('tg-data',JSON.stringify(data));
function toast(t){let el=$('#toast');el.textContent=t;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2100)}
function dateLabel(s){return dateObj(s).toLocaleDateString('tr-TR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}
function mins(a){let [h,m]=a.split(':').map(Number);return h*60+m}
function duration(a){return Number.isFinite(a.durationMinutes)?a.durationMinutes:Math.max(0,mins(a.end)-mins(a.start))}
function activitiesFor(s){return data.activities.filter(a=>a.date===s).sort((a,b)=>a.start.localeCompare(b.start))}
function showScreen(name){$$('.screen').forEach(x=>x.classList.remove('active'));$('#'+name+'Screen').classList.add('active');$$('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.screen===name));if(name==='calendar')renderCalendar();if(name==='analysis')renderAnalysis();if(name==='home')renderHome();if(name==='journal')loadPage()}
$$('[data-screen]').forEach(b=>b.onclick=()=>showScreen(b.dataset.screen));
$$('[data-go]').forEach(b=>b.onclick=()=>showScreen(b.dataset.go));
$('#todayBtn').onclick=()=>{selectedDate=todayISO();calendarDate=dateObj(selectedDate);renderHome();toast('Bugüne döndün ♡')};
function renderHome(){
 $('#prettyDate').textContent=dateLabel(todayISO()).toLocaleUpperCase('tr-TR');
 let acts=activitiesFor(todayISO()),total=acts.reduce((s,a)=>s+duration(a),0);
 $('#loggedTime').textContent=fmtDur(total);$('#activityCount').textContent=acts.length;
 $('#todayList').innerHTML=acts.length?acts.map(a=>`<div class="activity-row"><span class="activity-color" style="--c:${COLORS[a.category]||COLORS.Diğer}"></span><div><b>${esc(a.name)}</b><small>${a.start} – ${a.end} · ${a.category}</small></div><span class="duration">${fmtDur(duration(a))}</span><button class="delete-act" data-del="${a.id}">×</button></div>`).join():'<div class="routine-box">Bugün henüz kayıt yok. Küçük bir etkinlikle başlayabilirsin. ♡</div>';
 $('#todayList').querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{data.activities=data.activities.filter(a=>a.id!==b.dataset.del);save();renderHome();toast('Kayıt silindi')});
 let sums=categorySums(acts);$('#homeLegend').innerHTML=Object.entries(sums).filter(x=>x[1]>0).map(([c,m])=>`<span><i class="dot" style="background:${COLORS[c]}"></i>${c} ${Math.round(m/60*10)/10}s</span>`).join('')||'<span>Henüz zaman kaydı yok</span>';
 let grad=[],pos=0;Object.entries(sums).filter(x=>x[1]>0).forEach(([c,m])=>{let end=pos+m/1440*100;grad.push(`${COLORS[c]} ${pos}% ${end}%`);pos=end});if(pos<100)grad.push(`#eee6ee ${pos}% 100%`);$('#clock').style.background=`conic-gradient(${grad.join(',')})`;
}
function categorySums(acts){let s={};CATS.forEach(c=>s[c]=0);acts.forEach(a=>s[a.category]=(s[a.category]||0)+duration(a));return s}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function openModal(){ $('#activityModal').hidden=false;$('#activityName').focus()}
$('#quickAdd').onclick=openModal;$('#navAdd').onclick=openModal;$('#closeModal').onclick=()=>$('#activityModal').hidden=true;$('#activityModal').onclick=e=>{if(e.target.id==='activityModal')$('#activityModal').hidden=true};
$('#activityForm').onsubmit=e=>{e.preventDefault();let start=$('#startTime').value,end=$('#endTime').value;if(mins(end)<=mins(start)){toast('Bitiş saati başlangıçtan sonra olmalı.');return}data.activities.push({id:crypto.randomUUID(),date:selectedDate,name:$('#activityName').value.trim(),start,end,category:$('#activityCategory').value,memo:$('#activityMemo').value});save();$('#activityModal').hidden=true;e.target.reset();$('#startTime').value='09:00';$('#endTime').value='10:00';renderHome();renderCalendar();toast('Zaman günlüğüne eklendi ♡')};
$$('#calendarModes button').forEach(b=>b.onclick=()=>{calendarMode=b.dataset.mode;$$('#calendarModes button').forEach(x=>x.classList.toggle('selected',x===b));renderCalendar()});
$('#prevPeriod').onclick=()=>{if(calendarMode==='month')calendarDate.setMonth(calendarDate.getMonth()-1);else if(calendarMode==='year')calendarDate.setFullYear(calendarDate.getFullYear()-1);else calendarDate.setDate(calendarDate.getDate()-7);renderCalendar()};
$('#nextPeriod').onclick=()=>{if(calendarMode==='month')calendarDate.setMonth(calendarDate.getMonth()+1);else if(calendarMode==='year')calendarDate.setFullYear(calendarDate.getFullYear()+1);else calendarDate.setDate(calendarDate.getDate()+7);renderCalendar()};
function sumDay(s){return activitiesFor(s).reduce((n,a)=>n+duration(a),0)}
function renderCalendar(){
 let y=calendarDate.getFullYear(),m=calendarDate.getMonth(),content=$('#calendarContent');
 if(calendarMode==='month'){
 $('#periodTitle').textContent=calendarDate.toLocaleDateString('tr-TR',{month:'long',year:'numeric'});$('#periodSub').textContent='Aylık görünüm';
 let first=new Date(y,m,1),offset=(first.getDay()+6)%7,days=new Date(y,m+1,0).getDate(),cells='';
 ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'].forEach(d=>cells+=`<div class="weekday">${d}</div>`);
 for(let i=0;i<offset;i++)cells+='<div></div>';
 for(let d=1;d<=days;d++){let s=iso(new Date(y,m,d)),n=sumDay(s);cells+=`<button class="day-cell ${s===todayISO()?'today':''} ${s===selectedDate?'chosen':''}" data-date="${s}">${d}<span class="tiny-dots">${n?'<i></i>'.repeat(Math.min(3,Math.ceil(n/120))):''}</span></button>`}
 content.innerHTML=`<div class="calendar-grid">${cells}</div>`;
 content.querySelectorAll('[data-date]').forEach(b=>b.onclick=()=>{selectedDate=b.dataset.date;renderCalendar();showScreen('journal')});
 }else if(calendarMode==='week'){
 let start=new Date(calendarDate),dow=(start.getDay()+6)%7;start.setDate(start.getDate()-dow);let end=new Date(start);end.setDate(end.getDate()+6);
 $('#periodTitle').textContent=`${start.getDate()} – ${end.getDate()} ${end.toLocaleDateString('tr-TR',{month:'long'})}`;$('#periodSub').textContent=String(y);
 let names=['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'];content.innerHTML=`<div class="week-grid">${names.map((n,i)=>{let d=new Date(start);d.setDate(start.getDate()+i);let s=iso(d),v=sumDay(s);return `<button class="week-day" data-date="${s}"><small>${n}</small><b>${d.getDate()}</b><div class="week-dot" style="opacity:${v?Math.min(1,.3+v/500):.16}"></div><small>${v?fmtDur(v):'—'}</small></button>`}).join('')}</div>`;
 content.querySelectorAll('[data-date]').forEach(b=>b.onclick=()=>{selectedDate=b.dataset.date;showScreen('journal')});
 }else{
 $('#periodTitle').textContent=y;$('#periodSub').textContent='Yıllık zaman haritası';
 content.innerHTML=`<div class="year-grid">${Array.from({length:12},(_,mi)=>{let n=new Date(y,mi+1,0).getDate();return `<div class="year-month"><b>${new Date(y,mi,1).toLocaleDateString('tr-TR',{month:'long'})}</b><div class="year-days">${Array.from({length:n},(_,d)=>{let s=iso(new Date(y,mi,d+1));return `<i class="${sumDay(s)?'has':''}" title="${s}"></i>`}).join('')}</div></div>`}).join('')}</div>`;
 }
 let all=calendarMode==='year'?data.activities.filter(a=>a.date.startsWith(String(y))):calendarMode==='month'?data.activities.filter(a=>a.date.startsWith(`${y}-${String(m+1).padStart(2,'0')}`)):data.activities.filter(a=>{let d=dateObj(a.date),diff=(d-calendarDate)/86400000;return Math.abs(diff)<7});
 let total=all.reduce((n,a)=>n+duration(a),0);$('#calendarSummary').innerHTML=`<b>✧ ${calendarMode==='year'?'Yıl':calendarMode==='month'?'Ay':'Hafta'} özeti</b><p>${all.length} etkinlik · ${fmtDur(total)} kayıtlı zaman</p>`;
}
function renderAnalysis(){
 let now=dateObj(todayISO()),from,to;
 if(analysisRange==='day'){from=selectedDate;to=selectedDate}
 else if(analysisRange==='week'){let d=new Date(now);d.setDate(d.getDate()-6);from=iso(d);to=todayISO()}
 else if(analysisRange==='month'){from=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;to=todayISO()}
 else{from=`${now.getFullYear()}-01-01`;to=todayISO()}
 let acts=data.activities.filter(a=>a.date>=from&&a.date<=to),s=categorySums(acts),total=acts.reduce((n,a)=>n+duration(a),0);
 $('#analysisTotal').textContent=fmtDur(total);$('#analysisBar').style.background=`linear-gradient(90deg,${Object.entries(s).filter(x=>x[1]).map(([c,v],i,arr)=>`${COLORS[c]} ${arr.slice(0,i).reduce((n,x)=>n+x[1],0)/Math.max(1,total)*100}% ${(arr.slice(0,i+1).reduce((n,x)=>n+x[1],0)/Math.max(1,total)*100)}%`).join(',')||'#eee 0% 100%'})`;
 $('#categoryBreakdown').innerHTML=Object.entries(s).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]).map(([c,v])=>`<div class="break-row"><span>${c}</span><div class="track"><div class="fill" style="width:${v/Math.max(total,1)*100}%;--c:${COLORS[c]}"></div></div><small>${fmtDur(v)}</small></div>`).join('')||'<p class="muted">Bu dönemde henüz kayıt yok.</p>';
 let appUsage={};acts.forEach(a=>(a.contexts||[]).forEach(c=>appUsage[c.label]=(appUsage[c.label]||0)+(c.durationMinutes||0)));$('#contextBreakdown').innerHTML=Object.entries(appUsage).sort((a,b)=>b[1]-a[1]).map(([n,v])=>`<div class="break-row"><span>${esc(n)}</span><div class="track"><div class="fill" style="width:${v/Math.max(total,1)*100}%;--c:#d7a9c5"></div></div><small>${fmtDur(v)}</small></div>`).join('')||'<p class="muted">Canlı oturumlarında telefon / uygulama aralıkları işaretledikçe burada görünür.</p>'; 
 let morning=acts.filter(a=>mins(a.start)<600),common={};acts.forEach(a=>{let h=a.start.slice(0,2);common[h]=(common[h]||0)+1});let best=Object.entries(common).sort((a,b)=>b[1]-a[1])[0];
 $('#insightText').textContent=acts.length?`En çok zaman ayırdığın kategori ${Object.entries(s).sort((a,b)=>b[1]-a[1])[0][0]}. ${morning.length} etkinliğin sabah 10.00'dan önce başlamış.`:'Kayıt ekledikçe zaman örüntülerin burada görünür.';
 $('#routineBox').textContent=acts.length>=3?`Kayıtlarında en sık başlangıç saatin ${best[0]}:00 (${best[1]} etkinlik). Sabah saatlerinde ${morning.length} etkinlik kaydetmişsin. Bu örüntüler daha fazla veriyle netleşir.`:'Henüz yeterli veri yok. Birkaç gün kayıt tuttuktan sonra sabah ve çalışma rutinlerini burada görebileceksin.';
}
$$('#analysisModes button').forEach(b=>b.onclick=()=>{analysisRange=b.dataset.range;$$('#analysisModes button').forEach(x=>x.classList.toggle('selected',x===b));renderAnalysis()});
$('#savePage').onclick=savePage;
$('#prevDay').onclick=()=>changeDay(-1);$('#nextDay').onclick=()=>changeDay(1);
function changeDay(n){savePage();let d=dateObj(selectedDate);d.setDate(d.getDate()+n);selectedDate=iso(d);loadPage()}
$('#tearPage').onclick=tearPage;
$('#photoInput').onchange=e=>{let f=e.target.files[0];if(!f)return;let r=new FileReader();r.onload=()=>addPlaced(`<img class="placed photo" src="${r.result}" style="left:48%;top:8%">`);r.readAsDataURL(f);e.target.value=''};
$('#addText').onclick=()=>{let t=prompt('Sayfana eklemek istediğin metin:');if(t)addPlaced(`<div class="placed text" contenteditable="true" style="left:12%;top:40%">${esc(t)}</div>`)}
$('#stickerToggle').onclick=()=>$('#stickerTray').hidden=!$('#stickerTray').hidden;
$$('[data-sticker]').forEach(b=>b.onclick=()=>addPlaced(`<div class="placed sticker" style="left:60%;top:55%">${b.dataset.sticker}</div>`));
$$('[data-washi]').forEach(b=>b.onclick=()=>addPlaced(`<div class="placed" style="left:8%;top:2%;width:84%;height:13px;border-radius:4px;background:${{pink:'repeating-linear-gradient(45deg,#efc5d8 0 5px,#f8e2eb 5px 10px)',lilac:'repeating-linear-gradient(90deg,#cbbbe7 0 5px,#e5daf3 5px 10px)',gold:'repeating-linear-gradient(45deg,#e8d2a6 0 5px,#f6e9c9 5px 10px)',mint:'repeating-linear-gradient(90deg,#b9d6c7 0 5px,#e0eee6 5px 10px)'}[b.dataset.washi]};opacity:.9"></div>`));
let selectedObject=null,drawMode=false,drawingPath=null;
function showObjectToolbar(){let b=$('#objectToolbar');b.hidden=!selectedObject}
function selectObject(el){if(selectedObject)selectedObject.classList.remove('selected');selectedObject=el;if(el)el.classList.add('selected');showObjectToolbar()}
function addPlaced(markup){$('#canvasItems').insertAdjacentHTML('beforeend',markup);let el=$('#canvasItems').lastElementChild;enableDrag(el);selectObject(el);return el}
function enableDrag(el){if(el.dataset.bound==='1')return;el.dataset.bound='1';let sx,sy,ox,oy;el.addEventListener('pointerdown',e=>{if(drawMode||e.target.isContentEditable)return;e.stopPropagation();selectObject(el);let p=el.parentElement.getBoundingClientRect(),r=el.getBoundingClientRect();sx=e.clientX;sy=e.clientY;ox=r.left-p.left;oy=r.top-p.top;el.setPointerCapture(e.pointerId)});el.addEventListener('pointermove',e=>{if(!el.hasPointerCapture(e.pointerId))return;let p=el.parentElement.getBoundingClientRect();el.style.left=Math.max(0,Math.min(p.width-el.offsetWidth,ox+e.clientX-sx))+'px';el.style.top=Math.max(0,Math.min(p.height-el.offsetHeight,oy+e.clientY-sy))+'px'});el.addEventListener('pointerup',e=>{if(el.hasPointerCapture(e.pointerId))el.releasePointerCapture(e.pointerId);savePage()});el.addEventListener('click',e=>{e.stopPropagation();selectObject(el)})}
function enableAllDrag(){$$('#canvasItems .placed').forEach(enableDrag)}
function loadPage(){let page=data.pages[selectedDate]||{};$('#journalDate').textContent=dateLabel(selectedDate);$('#paperDate').textContent=dateObj(selectedDate).getDate();$('#paperMonth').textContent=dateObj(selectedDate).toLocaleDateString('tr-TR',{month:'long',year:'numeric'});$('#journalNote').value=page.note||'';$('#canvasItems').innerHTML=page.items||'';if(typeof drawSvg!=='undefined'){drawSvg.innerHTML=page.draw||'';drawSvg.querySelectorAll('path').forEach(bindStroke)}selectedObject=null;showObjectToolbar();enableAllDrag()}
$('#savePage').onclick=()=>{savePage();toast('Günlük sayfan saklandı ♡')};
$('#photoInput').onchange=e=>{let f=e.target.files[0];if(!f)return;let r=new FileReader();r.onload=()=>addPlaced(`<img class="placed photo" src="${r.result}" style="left:48%;top:8%">`);r.readAsDataURL(f);e.target.value=''};
$('#addText').onclick=()=>{let t=prompt('Sayfana eklemek istediğin metin:');if(t)addPlaced(`<div class="placed text" contenteditable="true" style="left:12%;top:40%">${esc(t)}</div>`)};
$('#stickerToggle').onclick=()=>$('#stickerTray').hidden=!$('#stickerTray').hidden;
$('#decorToggle').onclick=()=>$('#decorTray').hidden=!$('#decorTray').hidden;
$$('[data-sticker]').forEach(b=>b.onclick=()=>addPlaced(`<div class="placed sticker" style="left:60%;top:55%">${b.dataset.sticker}</div>`));
const washiBg={pink:'repeating-linear-gradient(45deg,#efc5d8 0 5px,#f8e2eb 5px 10px)',lilac:'repeating-linear-gradient(90deg,#cbbbe7 0 5px,#e5daf3 5px 10px)',gold:'repeating-linear-gradient(45deg,#e8d2a6 0 5px,#f6e9c9 5px 10px)',mint:'repeating-linear-gradient(90deg,#b9d6c7 0 5px,#e0eee6 5px 10px)'};
$$('[data-washi]').forEach(b=>b.onclick=()=>addPlaced(`<div class="placed washi-object" style="left:8%;top:2%;width:84%;height:15px;border-radius:4px;background:${washiBg[b.dataset.washi]}"></div>`));
$$('[data-decor]').forEach(b=>b.onclick=()=>{let t=b.dataset.decor;if(t==='line')addPlaced('<div class="placed decor-line" style="left:12%;top:40%;width:72%;height:2px;background:#d7a9c5"></div>');if(t==='dots')addPlaced('<div class="placed decor-dots" style="left:20%;top:50%">• · • · • · •</div>');if(t==='star')addPlaced('<div class="placed sticker" style="left:45%;top:45%">✧</div>');if(t==='tape')addPlaced('<div class="placed washi-object" style="left:10%;top:15%;width:80%;height:18px;background:repeating-linear-gradient(45deg,#eac9da 0 5px,#fff0f6 5px 10px)"></div>')});
$('#objectDelete').onclick=()=>{if(selectedObject){selectedObject.remove();selectedObject=null;showObjectToolbar();savePage()}};
function scaleSelected(f){if(!selectedObject)return;if(selectedObject.tagName.toLowerCase()==='path'){selectedObject.setAttribute('stroke-width',Math.max(1,Number(selectedObject.getAttribute('stroke-width')||2.5)*f));savePage();return}let w=selectedObject.offsetWidth,h=selectedObject.offsetHeight;selectedObject.style.width=Math.max(20,w*f)+'px';selectedObject.style.height=Math.max(15,h*f)+'px';savePage()}
$('#objectBigger').onclick=()=>scaleSelected(1.12);$('#objectSmaller').onclick=()=>scaleSelected(.89);
$('#objectRotate').onclick=()=>{if(!selectedObject)return;let r=Number(selectedObject.dataset.rotation||0)+15;selectedObject.dataset.rotation=r;selectedObject.style.transform=`rotate(${r}deg)`;savePage()};
$('#objectEdit').onclick=()=>{if(selectedObject?.classList.contains('text')){selectedObject.contentEditable='true';selectedObject.focus()}else if(selectedObject?.tagName==='IMG'){let alt=prompt('Görsel açıklaması / etiketi',selectedObject.alt||'');if(alt!==null){selectedObject.alt=alt;savePage()}}};
$('#objectFront').onclick=()=>{if(selectedObject){$('#canvasItems').appendChild(selectedObject);savePage()}};
$('#objectBack').onclick=()=>{if(selectedObject){$('#canvasItems').insertBefore(selectedObject,$('#canvasItems').firstChild);savePage()}};
const drawSvg=document.createElementNS('http://www.w3.org/2000/svg','svg');drawSvg.id='drawOverlay';drawSvg.setAttribute('viewBox','0 0 320 360');drawSvg.setAttribute('preserveAspectRatio','none');$('#paperContent').appendChild(drawSvg);
$('#drawToggle').onclick=()=>{drawMode=!drawMode;drawSvg.style.display=drawMode?'block':'none';drawSvg.style.pointerEvents=drawMode?'auto':'none';toast(drawMode?'El yazısı modu açık':'El yazısı modu kapalı')};
drawSvg.addEventListener('pointerdown',e=>{if(!drawMode)return;let r=drawSvg.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*320,y=(e.clientY-r.top)/r.height*360;drawingPath=document.createElementNS('http://www.w3.org/2000/svg','path');drawingPath.setAttribute('d',`M ${x} ${y}`);drawingPath.setAttribute('fill','none');drawingPath.setAttribute('stroke','#a778a7');drawingPath.setAttribute('stroke-width','2.5');drawingPath.setAttribute('stroke-linecap','round');drawingPath.setAttribute('stroke-linejoin','round');drawSvg.appendChild(drawingPath);drawSvg.setPointerCapture(e.pointerId)});
drawSvg.addEventListener('pointermove',e=>{if(!drawingPath||!drawMode)return;let r=drawSvg.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*320,y=(e.clientY-r.top)/r.height*360;drawingPath.setAttribute('d',drawingPath.getAttribute('d')+` L ${x} ${y}`)});
function bindStroke(path){if(path.dataset.bound==='1')return;path.dataset.bound='1';path.addEventListener('click',e=>{e.stopPropagation();selectObject(path)});let sx=0,sy=0;path.addEventListener('pointerdown',e=>{if(drawMode)return;e.stopPropagation();selectObject(path);sx=e.clientX;sy=e.clientY;path.setPointerCapture(e.pointerId)});path.addEventListener('pointermove',e=>{if(drawMode||!path.hasPointerCapture(e.pointerId))return;let dx=e.clientX-sx,dy=e.clientY-sy,t=path.dataset.shift||'0,0',[tx0,ty0]=t.split(',').map(Number),tx=tx0+dx,ty=ty0+dy;path.dataset.shift=`${tx},${ty}`;path.style.transform=`translate(${tx}px,${ty}px)`;sx=e.clientX;sy=e.clientY});path.addEventListener('pointerup',e=>{if(path.hasPointerCapture(e.pointerId))path.releasePointerCapture(e.pointerId);savePage()})}
['pointerup','pointercancel'].forEach(ev=>drawSvg.addEventListener(ev,()=>{if(drawingPath){const path=drawingPath;bindStroke(path);drawingPath=null;savePage()}}));
let pullStart=null;$('#paper').addEventListener('pointerdown',e=>{if(e.target.closest('#canvasItems,.paper-content textarea,.journal-tools,.object-toolbar'))return;pullStart={x:e.clientX,y:e.clientY};$('#paper').classList.add('pulling')});$('#paper').addEventListener('pointermove',e=>{if(!pullStart)return;let dy=Math.min(0,e.clientY-pullStart.y),dx=e.clientX-pullStart.x;if(dy<-12&&Math.abs(dx)<100){let p=$('#paper');p.style.transform=`translateY(${Math.max(-90,dy*.35)}px) rotate(${Math.max(-3,Math.min(3,dx*.015))}deg)`;p.style.filter=`drop-shadow(0 ${Math.min(20,Math.abs(dy)*.08)}px 12px #74556a33)`}});$('#paper').addEventListener('pointerup',e=>{if(!pullStart)return;let dy=e.clientY-pullStart.y,dx=e.clientX-pullStart.x;pullStart=null;$('#paper').classList.remove('pulling');$('#paper').style.transform='';$('#paper').style.filter='';if(dy<-95&&Math.abs(dx)<100)tearPage()});$('#paper').addEventListener('pointercancel',()=>{pullStart=null;$('#paper').style.transform='';$('#paper').style.filter=''});
function tearPage(){savePage();let p=$('#paper');p.classList.add('tearing');setTimeout(()=>{let d=dateObj(selectedDate);d.setDate(d.getDate()+1);selectedDate=iso(d);loadPage();p.classList.remove('tearing');toast('Yeni günün sayfası açıldı ♡')},520)}
$$('[data-theme]').forEach(b=>b.onclick=()=>{data.theme=b.dataset.theme;save();applyTheme();$$('[data-theme]').forEach(x=>x.classList.toggle('chosen',x===b));toast('Tema değiştirildi')});
function applyTheme(){document.body.dataset.theme=data.theme||'pearl';$$('[data-theme]').forEach(x=>x.classList.toggle('chosen',x.dataset.theme===data.theme))}
$('#exportData').onclick=()=>{let blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='time-garden-yedek.json';a.click();URL.revokeObjectURL(a.href)};
$('#importData').onchange=e=>{let f=e.target.files[0];if(!f)return;let r=new FileReader();r.onload=()=>{try{let d=JSON.parse(r.result);if(!Array.isArray(d.activities)||!d.pages)throw Error();data=d;save();applyTheme();renderHome();renderCalendar();toast('Yedek geri yüklendi')}catch{toast('Dosya okunamadı')}};r.readAsText(f)};
$('#screenInfo').onclick=()=>alert('Apple Ekran Süresi verileri Safari içindeki bir PWA tarafından doğrudan okunamaz. Bu özellik için daha sonra Swift ile yerel iOS uygulaması ve Apple FamilyControls / DeviceActivity yetkilendirmeleri gerekir.');
$('#todayBtn').title='Bugüne dön';
// Real-time primary task timer. Secondary phone/app intervals overlap and do not stop the task timer.
function clockText(d){return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}
function renderLiveSession(){let s=data.currentSession,box=$('#liveSession');box.hidden=!s;if(!s)return;$('#liveTaskName').textContent=s.name;let now=s.pausedAt||Date.now(),sec=Math.max(0,Math.floor((now-s.startedAt-(s.pausedTotal||0))/1000));$('#liveElapsed').textContent=`${String(Math.floor(sec/3600)).padStart(2,'0')}:${String(Math.floor(sec%3600/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;let active=s.contexts.filter(x=>!x.endedAt);$('#liveContextLabel').textContent=active.length?`${active.length} paralel kayıt açık · ana etkinlik ${s.pausedAt?'duraklatıldı':'devam ediyor'}`:(s.pausedAt?'Ana etkinlik duraklatıldı':'Ana etkinlik sürüyor');$('#phoneStart').textContent='＋ Paralel kayıt';$('#sessionPause').textContent=s.pausedAt?'Devam et':'Duraklat';$('#liveContextList').innerHTML=s.contexts.map((c,i)=>`<span class="live-context-chip">${esc(c.label)} ${c.endedAt?'✓':`<button type="button" data-end-context="${i}" aria-label="${esc(c.label)} kaydını bitir">×</button>`}</span>`).join('');$('#liveContextList').querySelectorAll('[data-end-context]').forEach(b=>b.onclick=()=>{let c=s.contexts[Number(b.dataset.endContext)];if(c&&!c.endedAt)c.endedAt=Date.now();save();renderLiveSession()})}
function startLiveSession(){if(data.currentSession){toast('Zaten açık bir oturum var.');return}data.currentSession={id:crypto.randomUUID(),name:$('#activityName').value.trim(),category:$('#activityCategory').value,startedAt:Date.now(),pausedAt:null,pausedTotal:0,contexts:[]};save();$('#activityModal').hidden=true;renderLiveSession();toast('Zaman ölçümü başladı ♡')}
$('#startTimer').onclick=startLiveSession;
$('#phoneStart').onclick=()=>{let s=data.currentSession;if(!s)return;let label=prompt('Paralel olarak hangi uygulamayı/etkinliği yapıyorsun?','Instagram');if(label&&label.trim()){s.contexts.push({label:label.trim(),startedAt:Date.now(),endedAt:null});save();renderLiveSession();toast('Paralel kayıt başladı; ana zamanlayıcı etkilenmedi.')}};
$('#sessionPause').onclick=()=>{let s=data.currentSession;if(!s)return;if(s.pausedAt){s.pausedTotal=(s.pausedTotal||0)+(Date.now()-s.pausedAt);s.pausedAt=null;toast('Ana oturum devam ediyor')}else{s.pausedAt=Date.now();toast('Ana oturum duraklatıldı')}save();renderLiveSession()};
$('#sessionStop').onclick=()=>{let s=data.currentSession;if(!s)return;let now=Date.now();s.contexts.filter(x=>!x.endedAt).forEach(c=>c.endedAt=now);let effectiveEnd=s.pausedAt||now,elapsed=Math.max(0,effectiveEnd-s.startedAt-(s.pausedTotal||0));let a=new Date(s.startedAt),b=new Date(now),durationMinutes=Math.max(0,Math.round(elapsed/60000));let contexts=s.contexts.map(x=>({...x,durationMinutes:Math.max(0,Math.round(((x.endedAt||now)-x.startedAt)/60000)),overlapsPrimary:true}));data.activities.push({id:s.id,date:iso(a),name:s.name,category:s.category,start:clockText(a),end:clockText(b),durationMinutes,contexts,memo:'Canlı zaman oturumu',pausedTotal:s.pausedTotal||0});data.sessions=data.sessions||[];data.sessions.push({...s,endedAt:now,contexts});data.currentSession=null;save();renderLiveSession();renderHome();renderCalendar();toast(`Oturum kaydedildi · ${fmtDur(durationMinutes)}`)};
setInterval(renderLiveSession,1000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)renderLiveSession()});renderLiveSession();

// Sticker Atelier: client-side washi treatment + exportable transparent PNG.
let studioImage=null,studioDataUrl=null;
const studioCanvas=$('#stickerCanvas'),studioCtx=studioCanvas.getContext('2d');
const studioStyles={
 pink:{bg:'#f8e5ef',accent:'#d88eb6',tape:'#efbfd6'},moon:{bg:'#e9e5f5',accent:'#9588c5',tape:'#c9bde9'},
 botanical:{bg:'#e7efe7',accent:'#799c83',tape:'#b9d2bd'},pixel:{bg:'#e8e6f4',accent:'#8175b7',tape:'#bcb4e7'},lilac:{bg:'#eee7f6',accent:'#a48bc6',tape:'#d3c2e9'}
};
function drawStudio(){if(!studioImage)return;let st=studioStyles[$('#stickerStyle').value]||studioStyles.pink,ctx=studioCtx;ctx.clearRect(0,0,480,480);
 // Soft paper backing and decorative washi header
 ctx.save();ctx.shadowColor='rgba(70,45,70,.18)';ctx.shadowBlur=18;ctx.fillStyle='#fff';ctx.beginPath();ctx.roundRect(45,35,390,410,42);ctx.fill();ctx.restore();
 ctx.save();ctx.translate(240,75);ctx.rotate(-.035);ctx.fillStyle=st.tape;ctx.fillRect(-112,-14,224,28);ctx.restore();
 // Fit source image into a rounded sticker window; preserve the original image, do not pretend to remove its background.
 let iw=studioImage.naturalWidth,ih=studioImage.naturalHeight,scale=Math.min(330/iw,270/ih),w=iw*scale,h=ih*scale,x=(480-w)/2,y=220-h/2;
 ctx.save();ctx.shadowColor=st.accent+'88';ctx.shadowBlur=18;ctx.fillStyle='#fff';ctx.beginPath();ctx.roundRect(x-10,y-10,w+20,h+20,24);ctx.fill();ctx.restore();
 ctx.save();ctx.beginPath();ctx.roundRect(x,y,w,h,18);ctx.clip();ctx.drawImage(studioImage,x,y,w,h);ctx.restore();
 ctx.fillStyle=st.accent;ctx.font='bold 28px sans-serif';ctx.textAlign='center';ctx.fillText($('#stickerEmoji').value||'✧',240,395);
 ctx.fillStyle=st.accent;ctx.globalAlpha=.8;ctx.font='16px sans-serif';ctx.fillText('✦  ✧  ✦',240,425);ctx.globalAlpha=1;
 studioDataUrl=studioCanvas.toDataURL('image/png');$('#saveSticker').disabled=false;$('#studioHint').textContent='Önizleme hazır · PNG çıkartmanı indirebilir veya günlük sayfana ekleyebilirsin.';
}
$('#openStudio').onclick=()=>{$('#studioModal').hidden=false};$('#closeStudio').onclick=()=>$('#studioModal').hidden=true;
$('#studioModal').addEventListener('click',e=>{if(e.target.id==='studioModal')$('#studioModal').hidden=true});
$('#studioPhoto').onchange=e=>{let f=e.target.files?.[0];if(!f)return;if(!f.type.startsWith('image/')){toast('Lütfen bir görsel seç.');return}let r=new FileReader();r.onload=()=>{let im=new Image();im.onload=()=>{studioImage=im;drawStudio()};im.src=r.result};r.readAsDataURL(f)};
$('#stickerStyle').onchange=drawStudio;$('#stickerEmoji').oninput=drawStudio;$('#makeSticker').onclick=()=>{if(!studioImage){toast('Önce fotoğraf seçmelisin.');return}drawStudio();toast('Washi çıkartman hazır ♡')};
$('#saveSticker').onclick=()=>{if(!studioDataUrl)return;let a=document.createElement('a');a.href=studioDataUrl;a.download=`time-garden-${$('#stickerStyle').value}-sticker.png`;a.click();
 // Also place the generated PNG onto the open journal page as an editable object.
 let safe=studioDataUrl;addPlaced(`<img class="placed photo-sticker" src="${safe}" style="left:28%;top:22%;width:44%">`);savePage();$('#studioModal').hidden=true;toast('Çıkartma indirildi ve sayfana eklendi ♡')};

if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
applyTheme();renderHome();renderCalendar();renderAnalysis();loadPage();
