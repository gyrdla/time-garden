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
if(!data.activities)data.activities=[];if(!data.pages)data.pages={};
const save=()=>localStorage.setItem('tg-data',JSON.stringify(data));
function toast(t){let el=$('#toast');el.textContent=t;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2100)}
function dateLabel(s){return dateObj(s).toLocaleDateString('tr-TR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}
function mins(a){let [h,m]=a.split(':').map(Number);return h*60+m}
function duration(a){return Math.max(0,mins(a.end)-mins(a.start))}
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
 let morning=acts.filter(a=>mins(a.start)<600),common={};acts.forEach(a=>{let h=a.start.slice(0,2);common[h]=(common[h]||0)+1});let best=Object.entries(common).sort((a,b)=>b[1]-a[1])[0];
 $('#insightText').textContent=acts.length?`En çok zaman ayırdığın kategori ${Object.entries(s).sort((a,b)=>b[1]-a[1])[0][0]}. ${morning.length} etkinliğin sabah 10.00'dan önce başlamış.`:'Kayıt ekledikçe zaman örüntülerin burada görünür.';
 $('#routineBox').textContent=acts.length>=3?`Kayıtlarında en sık başlangıç saatin ${best[0]}:00 (${best[1]} etkinlik). Sabah saatlerinde ${morning.length} etkinlik kaydetmişsin. Bu örüntüler daha fazla veriyle netleşir.`:'Henüz yeterli veri yok. Birkaç gün kayıt tuttuktan sonra sabah ve çalışma rutinlerini burada görebileceksin.';
}
$$('#analysisModes button').forEach(b=>b.onclick=()=>{analysisRange=b.dataset.range;$$('#analysisModes button').forEach(x=>x.classList.toggle('selected',x===b));renderAnalysis()});
function loadPage(){let page=data.pages[selectedDate]||{};$('#journalDate').textContent=dateLabel(selectedDate);$('#paperDate').textContent=dateObj(selectedDate).getDate();$('#paperMonth').textContent=dateObj(selectedDate).toLocaleDateString('tr-TR',{month:'long',year:'numeric'});$('#journalNote').value=page.note||'';$('#canvasItems').innerHTML=page.items||'';restoreDraw(page.draw||'')}
function savePage(){let old=data.pages[selectedDate]||{};data.pages[selectedDate]={...old,note:$('#journalNote').value,items:$('#canvasItems').innerHTML,draw:$('#drawCanvas').toDataURL()};save();toast('Günlük sayfan saklandı ♡')}
$('#savePage').onclick=savePage;
$('#prevDay').onclick=()=>changeDay(-1);$('#nextDay').onclick=()=>changeDay(1);
function changeDay(n){savePage();let d=dateObj(selectedDate);d.setDate(d.getDate()+n);selectedDate=iso(d);loadPage()}
$('#tearPage').onclick=()=>{savePage();let p=$('#paper');p.animate([{transform:'translateY(0) rotate(0)',opacity:1},{transform:'translateY(-70px) rotate(-4deg)',opacity:.1}],{duration:420,easing:'ease-in'}).onfinish=()=>{changeDay(1);p.style.transform='';p.style.opacity='';toast('Yeni günün sayfası açıldı ♡')}};
$('#photoInput').onchange=e=>{let f=e.target.files[0];if(!f)return;let r=new FileReader();r.onload=()=>addPlaced(`<img class="placed photo" src="${r.result}" style="left:48%;top:8%">`);r.readAsDataURL(f);e.target.value=''};
$('#addText').onclick=()=>{let t=prompt('Sayfana eklemek istediğin metin:');if(t)addPlaced(`<div class="placed text" contenteditable="true" style="left:12%;top:40%">${esc(t)}</div>`)}
$('#stickerToggle').onclick=()=>$('#stickerTray').hidden=!$('#stickerTray').hidden;
$$('[data-sticker]').forEach(b=>b.onclick=()=>addPlaced(`<div class="placed sticker" style="left:60%;top:55%">${b.dataset.sticker}</div>`));
$$('[data-washi]').forEach(b=>b.onclick=()=>addPlaced(`<div class="placed" style="left:8%;top:2%;width:84%;height:13px;border-radius:4px;background:${{pink:'repeating-linear-gradient(45deg,#efc5d8 0 5px,#f8e2eb 5px 10px)',lilac:'repeating-linear-gradient(90deg,#cbbbe7 0 5px,#e5daf3 5px 10px)',gold:'repeating-linear-gradient(45deg,#e8d2a6 0 5px,#f6e9c9 5px 10px)',mint:'repeating-linear-gradient(90deg,#b9d6c7 0 5px,#e0eee6 5px 10px)'}[b.dataset.washi]};opacity:.9"></div>`));
function addPlaced(markup){$('#canvasItems').insertAdjacentHTML('beforeend',markup);enableDrag($('#canvasItems').lastElementChild)}
function enableDrag(el){let sx,sy,ox,oy;el.addEventListener('pointerdown',e=>{e.preventDefault();let rect=el.parentElement.getBoundingClientRect(),r=el.getBoundingClientRect();sx=e.clientX;sy=e.clientY;ox=r.left-rect.left;oy=r.top-rect.top;el.setPointerCapture(e.pointerId);el.style.zIndex=99});el.addEventListener('pointermove',e=>{if(!el.hasPointerCapture(e.pointerId))return;let r=el.parentElement.getBoundingClientRect();el.style.left=Math.max(0,Math.min(r.width-el.offsetWidth,ox+e.clientX-sx))+'px';el.style.top=Math.max(0,Math.min(r.height-el.offsetHeight,oy+e.clientY-sy))+'px'});el.addEventListener('pointerup',e=>{if(el.hasPointerCapture(e.pointerId))el.releasePointerCapture(e.pointerId)})}
function enableAllDrag(){ $$('#canvasItems .placed').forEach(enableDrag)}
const canvas=$('#drawCanvas'),ctx=canvas.getContext('2d');let drawing=false;
function sizeCanvas(){let r=canvas.getBoundingClientRect(),dpr=devicePixelRatio||1;canvas.width=r.width*dpr;canvas.height=r.height*dpr;ctx.scale(dpr,dpr);ctx.lineWidth=2;ctx.lineCap='round';ctx.strokeStyle='#a778a7'}
function restoreDraw(dataUrl){ctx.clearRect(0,0,canvas.width,canvas.height);if(dataUrl&&dataUrl.length>100){let im=new Image();im.onload=()=>ctx.drawImage(im,0,0,canvas.width,canvas.height);im.src=dataUrl}}
$('#drawToggle').onclick=()=>{let on=canvas.style.pointerEvents!=='auto';canvas.style.pointerEvents=on?'auto':'none';canvas.style.display=on?'block':'none';if(on)sizeCanvas();toast(on?'El yazısı modu açık':'El yazısı modu kapalı')};
canvas.addEventListener('pointerdown',e=>{drawing=true;let r=canvas.getBoundingClientRect();ctx.beginPath();ctx.moveTo(e.clientX-r.left,e.clientY-r.top)});
canvas.addEventListener('pointermove',e=>{if(!drawing)return;let r=canvas.getBoundingClientRect();ctx.lineTo(e.clientX-r.left,e.clientY-r.top);ctx.stroke()});['pointerup','pointerleave'].forEach(ev=>canvas.addEventListener(ev,()=>drawing=false));
$$('[data-theme]').forEach(b=>b.onclick=()=>{data.theme=b.dataset.theme;save();applyTheme();$$('[data-theme]').forEach(x=>x.classList.toggle('chosen',x===b));toast('Tema değiştirildi')});
function applyTheme(){document.body.dataset.theme=data.theme||'pearl';$$('[data-theme]').forEach(x=>x.classList.toggle('chosen',x.dataset.theme===data.theme))}
$('#exportData').onclick=()=>{let blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='time-garden-yedek.json';a.click();URL.revokeObjectURL(a.href)};
$('#importData').onchange=e=>{let f=e.target.files[0];if(!f)return;let r=new FileReader();r.onload=()=>{try{let d=JSON.parse(r.result);if(!Array.isArray(d.activities)||!d.pages)throw Error();data=d;save();applyTheme();renderHome();renderCalendar();toast('Yedek geri yüklendi')}catch{toast('Dosya okunamadı')}};r.readAsText(f)};
$('#screenInfo').onclick=()=>alert('Apple Ekran Süresi verileri Safari içindeki bir PWA tarafından doğrudan okunamaz. Bu özellik için daha sonra Swift ile yerel iOS uygulaması ve Apple FamilyControls / DeviceActivity yetkilendirmeleri gerekir.');
$('#todayBtn').title='Bugüne dön';
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
applyTheme();renderHome();renderCalendar();renderAnalysis();loadPage();
