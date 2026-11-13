const epcIcons={"Voorgevel": "voorgevel.svg", "Achtergevel": "achtergevel.svg", "Linkergevel": "linkergevel.svg", "Rechtergevel": "rechtergevel.svg", "Hellend dak voor": "hellend-dak-voor.svg", "Hellend dak achter": "hellend-dak-achter.svg", "Hellend dak links": "hellend-dak-links.svg", "Hellend dak rechts": "hellend-dak-rechts.svg", "Plat dak": "plat-dak.svg", "Plafond": "plafond.svg", "Vloer": "vloer.svg", "Opwekker verwarming": "opwekker-verwarming.svg", "Verwarmingsinstallatie": "verwarmingsinstallatie.svg", "Actieve koeling": "actieve-koeling.svg", "Opwekker sanitair warm water": "opwekker-sanitair-warm-water.svg", "Opwekker SWW": "opwekker-sanitair-warm-water.svg", "Ventilatie-unit": "continu-draaiend-ventilatietoestel.svg", "Ventilatieruimte": "ventilatie-ruimte.svg", "Continue ventilatie-eenheid": "continu-draaiend-ventilatietoestel.svg", "Ventilatie - Ruimte": "ventilatie-ruimte.svg", "Zonneboiler": "zonneboiler.svg", "PV-panelen": "pv-panelen.svg", "Verlichting": "verlichting.svg"};
function iconFor(name){const img=document.createElement('img');img.src='ico/'+(epcIcons[name]||'gevelconstructie.svg');img.alt='';img.className='epc-item-icon';img.loading='lazy';return img}
(()=>{'use strict';
const $=id=>document.getElementById(id), show=(id,on=true)=>$(id).classList.toggle('hidden',!on);let db=null,user=null,workspace=null,current=null,activeDossier=null,activeFacade=null,activeConstruction=null,activeEnvelope=null,activeEnvelopeRecord=null,activeEnvelopeConstruction=null,activeInstallationSection=null,activeInstallation=null,routeToken=0,authBootstrapped=false,activeScreen='auth',mode='login',items=[],sortBy='date';
const sections=['Algemene gegevens','Gevels','Type openingen','Openingen','Hellende daken','Platte daken','Plafonds','Vloeren','Verwarming','Sanitair warm water','Ventilatie','Koeling','PV-panelen','Zonneboiler','Verlichting','Ruimtes'];

function note(s){$('notice').textContent=s;$('notice').classList.add('show');clearTimeout(note.timer);note.timer=setTimeout(()=>$('notice').classList.remove('show'),2600)}
function err(e){note(e?.message||String(e))}
// Public project settings are deployed with the app, not entered by each user.
// A publishable/anon key is NOT a secret. Never use a service_role or sb_secret key here.
function config(){
 const c=window.EPC_BUDDY_CONFIG;
 if(!c||typeof c.url!=='string'||typeof c.key!=='string')return null;
 const url=c.url.trim().replace(/\/$/,'');
 const key=c.key.trim();
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url))return null;
 if(key.includes('VUL_HIER')||url.includes('JOUW-PROJECT-REF'))return null;
 if(!(key.startsWith('sb_publishable_')||key.startsWith('eyJ')))return null;
 return {url,key};
}
// Navigation continuity on mobile: the external camera can evict the browser tab.
// sessionStorage holds ONLY opaque navigation identifiers, never photos, tokens or client data.
const VIEW_KEY='epc-buddy-view-v1';
function persistInspectionView(){
 try{
  if(!user||!activeDossier||activeScreen==='auth'||activeScreen==='home'){
   sessionStorage.removeItem(VIEW_KEY);return;
  }
  sessionStorage.setItem(VIEW_KEY,JSON.stringify({
   userId:user.id,dossierId:activeDossier.id,screen:activeScreen,
   facadeId:activeFacade?.id||null,envelopeId:activeEnvelopeRecord?.id||null,
   envelopeName:activeEnvelope||null,installationId:activeInstallationSection?.id||null
  }));
 }catch(_){} // Storage may be disabled by privacy settings.
}
async function restoreInspectionView(){
 let saved;
 try{saved=JSON.parse(sessionStorage.getItem(VIEW_KEY)||'null')}catch(_){return}
 if(!saved||saved.userId!==user?.id||!saved.dossierId)return;
 // Re-query with normal RLS. Never trust an ID from browser storage as authorization.
 const {data:dossier,error}=await db.from('epc_dossiers').select('*')
  .eq('id',saved.dossierId).eq('workspace_id',workspace).is('deleted_at',null).maybeSingle();
 if(error||!dossier){sessionStorage.removeItem(VIEW_KEY);return}
 activeDossier=dossier;current=dossier.id;
 screen('detail');renderDetail();await loadFacades();
 if(saved.screen==='facade-page'&&saved.facadeId){
  const {data}=await db.from('epc_facades').select('*').eq('id',saved.facadeId).eq('dossier_id',dossier.id).is('deleted_at',null).maybeSingle();
  if(data)await openFacade(data);
 }else if(saved.screen==='envelope-page'&&saved.envelopeId){
  const {data}=await db.from('epc_envelope_elements').select('*').eq('id',saved.envelopeId).eq('dossier_id',dossier.id).is('deleted_at',null).maybeSingle();
  if(data)await openEnvelope(data.name,data);
 }else if(saved.screen==='installation-page'&&saved.installationId){
  const {data}=await db.from('epc_installation_sections').select('*').eq('id',saved.installationId).eq('dossier_id',dossier.id).is('deleted_at',null).maybeSingle();
  if(data)await openInstallationSection(data);
 }
 // Editor screens are intentionally not restored: unsaved edits cannot be reconstructed safely.
}
function init(){const c=config();if(!c){screen('auth');note('Appconfiguratie ontbreekt. Neem contact op met de beheerder.');return}if(!window.supabase){screen('auth');note('Verbinding niet beschikbaar. Controleer je internetverbinding.');return}try{db=window.supabase.createClient(c.url,c.key);db.auth.onAuthStateChange((event,s)=>{
   // TOKEN_REFRESHED and USER_UPDATED must never send an active inspector back to Home.
   // Camera apps can background/resume the browser and trigger auth events.
   const nextUser=s?.user||null,oldId=user?.id||null,nextId=nextUser?.id||null;
   user=nextUser;
   if(!authBootstrapped)return; // getSession() handles the initial route exactly once.
   if(oldId!==nextId){if(!nextId)sessionStorage.removeItem(VIEW_KEY);setTimeout(()=>route(),0)}
  });
  db.auth.getSession().then(({data,error})=>{
   if(error)return err(error);
   const previousId=user?.id||null;
   user=data.session?.user||null;
   authBootstrapped=true;
   // Restore the previous screen after a real browser reload, e.g. camera process eviction.
   // Only opaque IDs are persisted; never credentials or dossier details.
   route({restore:true});
  })}catch(e){screen('auth');err(e)}}
function screen(id){activeScreen=id;persistInspectionView();['auth','home','editor','detail','facade-page','construction-editor','envelope-editor','envelope-page','installation-page','installation-editor','opening-page','opening-editor'].forEach(x=>show(x,x===id));show('logout',!!user);show('header-home',!!user);document.body.classList.toggle('app-logged-in',!!user);requestAnimationFrame(refreshScrollTop)}
async function route({restore=false}={}){
 const token=++routeToken;
 if(!db){screen('auth');return}
 if(!user){workspace=null;screen('auth');return}
 try{
  const uid=user.id;
  const {data,error}=await db.from('epc_workspace_members').select('workspace_id,role').eq('user_id',uid).limit(1);
  if(token!==routeToken||user?.id!==uid)return;
  if(error)throw error;
  workspace=data?.[0]?.workspace_id||null;
  screen('home');
  if(!workspace){note('Geen werkruimte gevonden voor dit account.');return}
  await load();
  if(restore)await restoreInspectionView();
 }catch(e){if(token===routeToken){screen('home');err(e)}}
}
$('logout').onclick=async()=>{if(db)await db.auth.signOut();user=null;route()};
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('selected',x===b));$('auth-submit').textContent=mode==='login'?'Inloggen':'Registreren';$('auth-note').textContent=mode==='signup'?'Na registratie kan e-mailbevestiging nodig zijn.':''});
$('auth-form').onsubmit=async e=>{e.preventDefault();const email=$('email').value.trim(),password=$('password').value;$('auth-submit').disabled=true;try{const r=mode==='login'?await db.auth.signInWithPassword({email,password}):await db.auth.signUp({email,password});if(r.error)throw r.error;if(mode==='signup')note('Registratie ontvangen. Controleer zo nodig je e-mail.');else{user=r.data.user;await route()}}catch(ex){err(ex)}finally{$('auth-submit').disabled=false}};
$('new').onclick=()=>edit(null);$('search').oninput=()=>render();$('year-filter').onchange=render;$('filter-button').onclick=()=>show('filter-panel',$('filter-panel').classList.contains('hidden'));document.querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{sortBy=b.dataset.sort;document.querySelectorAll('[data-sort]').forEach(x=>x.classList.toggle('selected',x===b))});$('sort-direction').onchange=render;$('apply-filters').onclick=()=>{show('filter-panel',false);render()};document.querySelectorAll('.filter-check input').forEach(c=>c.onchange=render);$('header-home').onclick=()=>{closeDrawer();activeFacade=null;activeDossier=null;screen('home');load()};$('back').onclick=$('cancel').onclick=()=>{if(activeDossier&&current===activeDossier.id){screen('detail');renderDetail();loadFacades()}else{screen('home');load()}};
async function load(){if(!workspace)return;const {data,error}=await db.from('epc_dossiers').select('id,dossier_number,dossier_type,client_name,property_address,inspection_date,updated_at').eq('workspace_id',workspace).is('deleted_at',null).order('updated_at',{ascending:false}).limit(250);if(error){err(error);return}items=data||[];const years=[...new Set(items.map(d=>String(d.inspection_date||'').slice(0,4)).filter(Boolean))].sort().reverse();const prev=$('year-filter').value;$('year-filter').innerHTML='<option value="all">Alle jaren</option>'+years.map(y=>`<option value="${y}">${y}</option>`).join('');$('year-filter').value=years.includes(prev)?prev:'all';render()}
function dossierType(d){const t=String(d.dossier_type||d.type||d.certificate_type||d.epc_type||d.destination||'RES').toLowerCase();return t.includes('knr')?'kNR':t==='gd'||t.includes('gemeen')?'GD':'RES'}
function render(){const q=$('search').value.toLocaleLowerCase(),year=$('year-filter').value,types=[...document.querySelectorAll('.filter-check input:checked')].map(c=>c.value);let results=items.filter(d=>(year==='all'||String(d.inspection_date||'').startsWith(year))&&types.includes(dossierType(d))&&[d.dossier_number,d.client_name,...Object.values(d.property_address||{})].join(' ').toLocaleLowerCase().includes(q));const dir=$('sort-direction').value==='asc'?1:-1;results.sort((a,b)=>dir*(sortBy==='name'?String(a.dossier_number||'').localeCompare(String(b.dossier_number||''),'nl',{numeric:true}):String(a.inspection_date||a.updated_at||'').localeCompare(String(b.inspection_date||b.updated_at||''))));$('dossiers').replaceChildren();if(!results.length){const empty=document.createElement('div');empty.className='empty-state';empty.innerHTML='<span class="empty-icon">▤</span><p>Geen dossiers gevonden.<br>Maak een dossier aan.</p>';$('dossiers').append(empty);return}results.forEach(d=>{const row=document.createElement('button');row.type='button';row.className='dossier-row';row.onclick=()=>open(d.id);const type=dossierType(d),tag=document.createElement('span');tag.className='type-tag type-'+type;tag.textContent=type;const txt=document.createElement('span');txt.className='dossier-row-text';const strong=document.createElement('strong');strong.textContent=d.dossier_number?'Dossier '+d.dossier_number:'Dossier zonder nummer';const address=document.createElement('small');const a=d.property_address||{};address.textContent=[a.street,a.number,[a.postal,a.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');const date=document.createElement('small');date.textContent='Bezoek: '+(d.inspection_date?new Date(d.inspection_date+'T12:00:00').toLocaleDateString('nl-BE'):'—');txt.append(strong,address,date);const chevron=document.createElement('span');chevron.className='row-chevron';chevron.textContent='›';row.append(tag,txt,chevron);$('dossiers').append(row)})}
const f=$('dossier-form');function field(name){return f.elements.namedItem(name)}
function edit(d){current=d?.id||null;f.reset();if(!d)renderDossierOverview(null);$('editor-title').textContent=d?'Dossier '+(d.dossier_number||''):'Nieuw dossier';show('delete-dossier',!!d);$('back').setAttribute('aria-label',d?'Terug naar dossier':'Terug naar dossiers');screen('editor');if(d){for(const k of ['dossier_number','inspection_date','client_kind','client_name','client_vat_number','client_phone','client_email'])field(k).value=d[k]||'';for(const [prefix,obj] of [['client',d.client_address],['property',d.property_address]])for(const k of ['street','number','postal','city'])field(prefix+'_'+k).value=obj?.[k]||'';$('same').checked=!!d.client_address_same_as_property;field('dossier_type').value=d.dossier_type||'RES'}toggle();renderDossierOverview(d)}

// Dossiergegevens: dezelfde compacte, per veld bewerkbare weergave als installaties.
let dossierOverviewEdit=null;
function renderDossierOverview(d){
 let wrap=$('dossier-overview');
 if(!wrap){wrap=document.createElement('div');wrap.id='dossier-overview';wrap.className='epc-dossier-overview';f.before(wrap)}
 wrap.replaceChildren();wrap.classList.toggle('hidden',!d);f.classList.toggle('epc-dossier-form-hidden',!!d);
 if(!d)return;
 dossierOverviewEdit=null;
 const heading=document.createElement('p');heading.textContent='Tik op een gegeven om het te bekijken of aan te passen.';wrap.append(heading);
 const fields=[['Dossiergegevens',['dossier_number','inspection_date','dossier_type']],['Opdrachtgever',['client_kind','client_name','client_phone','client_email','client_vat_number','same','client_street','client_number','client_postal','client_city']],['Te certificeren pand',['property_street','property_number','property_postal','property_city']]];
 const labels={dossier_number:'Dossiernummer',inspection_date:'Datum plaatsbezoek',dossier_type:'Type dossier',client_kind:'Type opdrachtgever',client_name:'Naam opdrachtgever',client_phone:'Telefoonnummer',client_email:'E-mail',client_vat_number:'Btw-nummer',same:'Zelfde adres als te certificeren pand',client_street:'Straat opdrachtgever',client_number:'Nummer opdrachtgever',client_postal:'Postcode opdrachtgever',client_city:'Gemeente opdrachtgever',property_street:'Straat pand',property_number:'Nummer pand',property_postal:'Postcode pand',property_city:'Gemeente pand'};
 function source(k){return k==='same'?$('same'):field(k)}
 function visible(k){if(k==='client_vat_number')return field('client_kind').value==='onderneming';if(k.startsWith('client_')&&['client_street','client_number','client_postal','client_city'].includes(k))return !$('same').checked;return true}
 function display(k){const el=source(k);if(k==='same')return el.checked?'Ja':'Nee';if(el.tagName==='SELECT')return el.selectedOptions[0]?.textContent||'Niet ingevuld';if(k==='inspection_date'&&el.value)return new Date(el.value+'T12:00:00').toLocaleDateString('nl-BE');return el.value||'Niet ingevuld'}
 function draw(){wrap.replaceChildren();wrap.append(heading);
 for(const [group,keys] of fields){const title=document.createElement('h2');title.textContent=group;wrap.append(title);
 for(const k of keys){if(!visible(k))continue;const block=document.createElement('div');block.className='epc-dossier-field';const label=document.createElement('label');label.textContent=labels[k];block.append(label);
 const button=document.createElement('button');button.type='button';button.className='epc-dossier-value';button.textContent=display(k);button.setAttribute('aria-expanded',String(dossierOverviewEdit===k));button.onclick=()=>{dossierOverviewEdit=dossierOverviewEdit===k?null:k;draw()};block.append(button);
 if(dossierOverviewEdit===k){const editor=document.createElement('div');editor.className='epc-dossier-inline';const original=source(k);const input=original.cloneNode(true);input.removeAttribute('id');input.removeAttribute('name');input.required=false;if(original.tagName==='SELECT')input.value=original.value;else if(original.type==='checkbox')input.checked=original.checked;else input.value=original.value;editor.append(input);
 const actions=document.createElement('div');actions.className='epc-dossier-inline-actions';const cancel=document.createElement('button');cancel.type='button';cancel.className='secondary';cancel.textContent='Annuleren';cancel.onclick=()=>{dossierOverviewEdit=null;draw()};const confirm=document.createElement('button');confirm.type='button';confirm.textContent='Bevestigen';confirm.onclick=()=>{if(original.type==='checkbox')original.checked=input.checked;else original.value=input.value;toggle();dossierOverviewEdit=null;draw()};actions.append(cancel,confirm);editor.append(actions);block.append(editor)}wrap.append(block)} }
 const save=document.createElement('button');save.type='button';save.className='epc-dossier-save';save.textContent='Wijzigingen opslaan';save.onclick=()=>{if(dossierOverviewEdit){note('Bevestig of sluit eerst het geopende veld.');return}f.requestSubmit()};wrap.append(save);
 const del=document.createElement('button');del.type='button';del.className='secondary epc-dossier-delete';del.textContent='Dossier verwijderen';del.onclick=()=>$('delete-dossier').click();wrap.append(del);
 }draw();
}

let dossierOpenVersion=0;
async function open(id){
 const version=++dossierOpenVersion;
 // Clear the previous dossier identity as well as its rendered content.
 // This prevents stale IDs from being persisted during navigation.
 activeDossier=null;
 activeFacade=null;
 activeEnvelopeRecord=null;
 activeInstallationSection=null;
 $('facade-list').replaceChildren();
 $('detail-title').textContent='Dossier laden…';
 screen('detail');
 beginEpcLoading('Dossier laden…');
 try {
 const {data,error}=await db.from('epc_dossiers').select('*').eq('id',id).eq('workspace_id',workspace).single();
 if(version!==dossierOpenVersion)return;
 if(error)throw error;
 activeDossier=data;
 // A fresh dossier must start from an empty list, never reuse the previous DOM.
 $('facade-list').replaceChildren();
 screen('detail');renderDetail();await loadFacades();window.scrollTo({top:0,behavior:'instant'});
 } catch(error){if(version===dossierOpenVersion){err(error);screen('home')}}
 finally {endEpcLoading()}
}
function renderDetail(){
 const d=activeDossier;if(!d)return;
 $('detail-title').textContent='Dossier '+(d.dossier_number||'');
 $('detail-date').textContent=d.inspection_date?new Date(d.inspection_date+'T12:00:00').toLocaleDateString('nl-BE'):'—';
 const a=d.property_address||{};
 $('detail-address').textContent=[a.street,a.number].filter(Boolean).join(' ')+(a.postal||a.city?'\n'+[a.postal,a.city].filter(Boolean).join(' '):'')||'—';
 $('detail-client').textContent=d.client_name||'—';
 $('detail-phone').textContent=d.client_phone||'';show('detail-phone-row',!!d.client_phone);
 $('detail-email').textContent=d.client_email||'';show('detail-email-row',!!d.client_email);
 $('detail-remark').textContent=d.remarks||'—';
}
// Eén herbruikbare rij voor gevels, dak-/vloeronderdelen en installaties.
// De verwijderknop staat naast (niet in) de openknop: geen geneste buttons.
function makeOverviewRow(name,subtitle,onOpen,onDelete){
 const wrapper=document.createElement('div');wrapper.className='epc-overview-item';
 const row=document.createElement('button');row.type='button';row.className='facade-row';
 const icon=document.createElement('span');icon.className='facade-icon';icon.append(iconFor(name));
 const text=document.createElement('span');text.className='facade-text';
 const title=document.createElement('strong');title.textContent=name;
 const sub=document.createElement('small');sub.textContent=subtitle;text.append(title,sub);
 const arrow=document.createElement('span');arrow.className='row-chevron';arrow.textContent='›';
 row.append(icon,text,arrow);row.onclick=onOpen;
 const del=document.createElement('button');del.type='button';del.className='epc-overview-delete';
 del.title='Verwijder '+name;del.setAttribute('aria-label','Verwijder '+name);
 const img=document.createElement('img');img.src='ico/delete.svg';img.alt='';del.append(img);
 del.onclick=onDelete;wrapper.append(row,del);return wrapper;
}
let overviewRequestVersion=0;
async function loadFacades(){
 if(!activeDossier)return;
 const dossierId=activeDossier.id;
 const requestVersion=++overviewRequestVersion;
 // Never show the previous dossier's tiles while a new dossier is loading.
 const list=$('facade-list');
 list.replaceChildren();
 const loading=document.createElement('p');
 loading.className='epc-list-loading';
 loading.textContent='Onderdelen laden…';
 list.append(loading);
 beginEpcLoading('Dossier laden…');
 try {
 // Independent dossier queries run concurrently, reducing mobile round trips.
 const [facadeResult,envelopeResult,childResult,sectionResult,entryResult,constructionResult]=await Promise.all([
  db.from('epc_facades').select('id,name,remarks').eq('dossier_id',dossierId).is('deleted_at',null).order('created_at',{ascending:true}),
  db.from('epc_envelope_elements').select('*').eq('dossier_id',dossierId).is('deleted_at',null).order('created_at',{ascending:true}),
  db.from('epc_envelope_constructions').select('envelope_id').eq('dossier_id',dossierId).is('deleted_at',null),
  db.from('epc_installation_sections').select('*').eq('dossier_id',dossierId).is('deleted_at',null),
  db.from('epc_installation_entries').select('section_id').eq('dossier_id',dossierId).is('deleted_at',null),
  db.from('epc_facade_constructions').select('facade_id').eq('dossier_id',dossierId).is('deleted_at',null)
 ]);
 if(requestVersion!==overviewRequestVersion || activeDossier?.id!==dossierId)return;
 for(const result of [facadeResult,envelopeResult,childResult,sectionResult,entryResult,constructionResult]){
  if(result.error)throw result.error;
 }
 const data=facadeResult.data,envelopes=envelopeResult.data,
       envelopeChildren=childResult.data,installationSections=sectionResult.data,
       installationEntries=entryResult.data,constructions=constructionResult.data;
 const envelopeCounts=new Map();
 for(const c of envelopeChildren||[])envelopeCounts.set(c.envelope_id,(envelopeCounts.get(c.envelope_id)||0)+1);
 const installationCounts=new Map();
 for(const x of installationEntries||[])installationCounts.set(x.section_id,(installationCounts.get(x.section_id)||0)+1);
 const host=$('facade-list');host.replaceChildren();
 const constructionCounts=new Map();
 for(const c of constructions||[])constructionCounts.set(c.facade_id,(constructionCounts.get(c.facade_id)||0)+1);
 // Gebruik de volgorde van het toevoegmenu, onafhankelijk van het aanmaakmoment.
 const itemOrder=new Map(addItems.map(([name],index)=>[name.toLocaleLowerCase('nl-BE'),index]));
 data?.sort((a,b)=>(itemOrder.get(a.name.toLocaleLowerCase('nl-BE'))??999)-(itemOrder.get(b.name.toLocaleLowerCase('nl-BE'))??999));
 const allRows=[...(data||[]).map(f=>({type:'facade',name:f.name,record:f})),...(envelopes||[]).map(r=>({type:'envelope',name:r.name,record:r})),...(installationSections||[]).map(r=>({type:'installation',name:r.name,record:r}))];
 allRows.sort((a,b)=>(itemOrder.get(a.name.toLocaleLowerCase('nl-BE'))??999)-(itemOrder.get(b.name.toLocaleLowerCase('nl-BE'))??999));
 if(!allRows.length){const el=document.createElement('p');el.className='facade-empty';el.textContent='Nog geen onderdelen toegevoegd.';host.append(el);return}
 // De databasevolgorde wordt genegeerd: dezelfde vaste volgorde als het gele menu.
 for(const entry of allRows){
  if(entry.type==='installation'){
   const count=installationCounts.get(entry.record.id)||0;
   host.append(makeOverviewRow(entry.name,count===1?'1 installatie':count+' installaties',
    ()=>openInstallationSection(entry.record),
    ()=>{activeInstallationSection=entry.record;$('installation-section-delete').click()}));
  }else if(entry.type==='envelope'){
   const count=envelopeCounts.get(entry.record.id)||0;
   host.append(makeOverviewRow(entry.name,count===1?'1 constructie':count+' constructies',
    ()=>openEnvelope(entry.name,entry.record),
    ()=>{activeEnvelope=entry.name;activeEnvelopeRecord=entry.record;$('envelope-page-delete').click()}));
  }else{
   const count=constructionCounts.get(entry.record.id)||0;
   const subtitle=count===0?'Gevelconstructie nog niet ingevuld':count===1?'1 gevelconstructie':count+' gevelconstructies';
   host.append(makeOverviewRow(entry.name,subtitle,()=>openFacade(entry.record),
    ()=>{activeFacade=entry.record;$('facade-delete').click()}));
  }
 }
 [...host.children].sort((a,b)=>{
  const aa=a.querySelector('.facade-text strong')?.textContent||'';
  const bb=b.querySelector('.facade-text strong')?.textContent||'';
  return (itemOrder.get(aa.toLocaleLowerCase('nl-BE'))??999)-(itemOrder.get(bb.toLocaleLowerCase('nl-BE'))??999);
 }).forEach(node=>host.append(node));
 } catch(error){if(activeDossier?.id===dossierId){$('facade-list').textContent='Onderdelen konden niet worden geladen.';err(error)}} finally { endEpcLoading(); }
}
// Gevelconstructies: lijst, uitschuifmenu en formulier, gekoppeld aan bestaande Supabase-tabellen.
function closeConstructionDrawer(){show('construction-overlay',false);show('construction-drawer',false);document.body.classList.remove('construction-drawer-open')}
function facadeHeader(){const el=$('facade-page-icon');el.replaceChildren(iconFor(activeFacade.name));$('facade-page-title').textContent=activeFacade.name}
async function openFacade(facade){activeFacade=facade;activeConstruction=null;facadeHeader();screen('facade-page');await loadConstructions();await loadSectionPhotos('facade',facade.id,'facade-page');window.scrollTo({top:0,behavior:'instant'})}
async function removeConstructionFromFacade(d){
 if(!activeFacade||!activeDossier)return;
 if(!confirm('Gevelconstructie "'+d.name+'" uit '+activeFacade.name+' verwijderen? Dezelfde constructie blijft in andere gevels behouden.'))return;
 const {error}=await db.from('epc_facade_constructions')
  .update({deleted_at:new Date().toISOString()})
  .eq('id',d.id).eq('facade_id',activeFacade.id).eq('dossier_id',activeDossier.id).is('deleted_at',null);
 if(error)return err(error);
 await loadConstructions();note('Gevelconstructie uit deze gevel verwijderd.');
}
async function loadConstructions(){
 if(!activeFacade||!activeDossier)return;
 const {data,error}=await db.from('epc_facade_constructions')
 .select('id,name,boundary,fully_glazed,insulation,insulation_thickness_mm,insulation_location,insulation_interruption,air_layer,wall_type,renovation_reference_year,remarks')
 .eq('dossier_id',activeDossier.id).eq('facade_id',activeFacade.id).is('deleted_at',null).order('created_at',{ascending:true});
 if(error)return err(error);
 const host=$('construction-list');host.replaceChildren();
 if(!data?.length){const empty=document.createElement('p');empty.className='construction-empty';empty.textContent='Nog geen gevelconstructies toegevoegd.';host.append(empty);return}
 for(const d of data){
  const row=document.createElement('div');row.className='construction-list-item';
  const b=document.createElement('button');b.type='button';b.className='construction-row';
  const icon=document.createElement('span');icon.className='construction-icon';icon.append(iconFor('Gevelconstructie'));
  const t=document.createElement('span');t.className='facade-text';
  const name=document.createElement('strong');name.textContent=d.name;
  const sub=document.createElement('small');sub.textContent='Gevelconstructie';t.append(name,sub);
  const arrow=document.createElement('span');arrow.className='row-chevron';arrow.textContent='›';
  b.append(icon,t,arrow);b.onclick=()=>openConstructionOpenings(d);
  const pencil=document.createElement('button');pencil.type='button';pencil.className='construction-item-edit';pencil.title='Constructie bewerken';pencil.setAttribute('aria-label','Bewerk '+d.name);pencil.textContent='✎';pencil.onclick=()=>editConstruction(d);
  const del=document.createElement('button');del.type='button';del.className='construction-item-delete';
  del.title='Verwijder uit deze gevel';del.setAttribute('aria-label','Verwijder '+d.name+' uit '+activeFacade.name);
  const img=document.createElement('img');img.src='ico/delete.svg';img.alt='';img.className='delete-icon';del.append(img);
  del.onclick=()=>removeConstructionFromFacade(d);
  row.append(b,pencil,del);host.append(row);
 }
}
$('facade-back').onclick=()=>{activeFacade=null;screen('detail');renderDetail();loadFacades()};
$('facade-delete').onclick=async()=>{
 if(!activeFacade||!activeDossier)return;
 const facade=activeFacade;
 if(!confirm(facade.name+' verwijderen? Alle gevelconstructies worden uit deze gevel verwijderd, maar blijven behouden in andere gevels.'))return;
 const stamp=new Date().toISOString();
 // Eerst de koppelingen in deze gevel deactiveren, daarna de gevel zelf.
 const {error:linksError}=await db.from('epc_facade_constructions')
  .update({deleted_at:stamp}).eq('facade_id',facade.id).eq('dossier_id',activeDossier.id).is('deleted_at',null);
 if(linksError)return err(linksError);
 const {error}=await db.from('epc_facades').update({deleted_at:stamp})
  .eq('id',facade.id).eq('dossier_id',activeDossier.id);
 if(error)return err(error);
 activeFacade=null;screen('detail');await loadFacades();note('Gevel en bijbehorende koppelingen verwijderd.');
};
$('construction-add').onclick=async()=>{
 if(!activeFacade||!activeDossier)return;
 // De bibliotheek is dossierbreed: elke unieke constructienaam kan in meerdere gevels worden gebruikt.
 const {data,error}=await db.from('epc_facade_constructions')
   .select('*').eq('dossier_id',activeDossier.id).is('deleted_at',null)
   .order('created_at',{ascending:true});
 if(error)return err(error);
 const host=$('construction-drawer-items');host.replaceChildren();
 const add=document.createElement('button');add.type='button';add.className='add-option';
 add.append(iconFor('Gevelconstructie'),document.createTextNode('Nieuwe gevelconstructie'));
 add.onclick=()=>{closeConstructionDrawer();editConstruction(null)};
 host.append(add);
 const currentNames=new Set((data||[]).filter(d=>d.facade_id===activeFacade.id).map(d=>d.name.trim().toLocaleLowerCase('nl-BE')));
 const templates=new Map();
 for(const d of data||[]){
   const key=d.name.trim().toLocaleLowerCase('nl-BE');
   if(!templates.has(key))templates.set(key,d);
 }
 for(const [key,d] of templates){
   const line=document.createElement('div');line.className='construction-drawer-row';
   const b=document.createElement('button');b.type='button';
   b.append(iconFor('Gevelconstructie'),document.createTextNode(d.name));
   const alreadyAdded=currentNames.has(key);
   if(alreadyAdded){
     b.disabled=true;
     b.classList.add('construction-already-added');
     b.title='Reeds toegevoegd aan deze gevel';
     line.classList.add('construction-already-added');
   }else{
     b.title='Deze gevelconstructie toevoegen aan '+activeFacade.name;
     b.onclick=async()=>{
       b.disabled=true;
       const fields=['name','boundary','fully_glazed','insulation','insulation_thickness_mm','insulation_location','insulation_interruption','air_layer','wall_type','renovation_reference_year','remarks'];
       const payload={dossier_id:activeDossier.id,facade_id:activeFacade.id};
       for(const field of fields)payload[field]=d[field];
       const {error:insertError}=await db.from('epc_facade_constructions').insert(payload);
       if(insertError){b.disabled=false;return err(insertError)}
       closeConstructionDrawer();await loadConstructions();
       note('Gevelconstructie toegevoegd.');
     };
   }
   line.append(b);
   // Verwijderen gebeurt in het geveloverzicht/formulier; niet in de gedeelde bibliotheek.
   host.append(line);
 }
 show('construction-overlay');show('construction-drawer');
 document.body.classList.add('construction-drawer-open')
};
$('construction-overlay').onclick=$('construction-drawer-close').onclick=closeConstructionDrawer;
async function loadConstructionForEdit(id){const {data,error}=await db.from('epc_facade_constructions').select('*').eq('id',id).eq('facade_id',activeFacade.id).eq('dossier_id',activeDossier.id).single();if(error)return err(error);editConstruction(data)}
// Gedeelde detailweergave voor bestaande gevel-, dak-, plafond- en vloerconstructies.
// Het originele formulier blijft de bron voor validatie en databaseopslag.
function showConstructionOverview(form, editorId, enabled){
 const old=document.getElementById(editorId+'-overview');if(old)old.remove();
 form.classList.toggle('hidden',enabled);
 if(!enabled)return;
 const panel=document.createElement('div');panel.id=editorId+'-overview';panel.className='epc-construction-overview';
 const hint=document.createElement('p');hint.textContent='Tik op een gegeven om het te bekijken of aan te passen.';panel.append(hint);
 const fields=[...form.querySelectorAll('label')].filter(label=>{
  const input=label.querySelector('input[name],select[name],textarea[name]');return input&&!input.disabled&&!label.classList.contains('hidden')&&!label.closest('[data-overview-exclude]');
 });
 let active=null;
 const refresh=()=>{for(const row of panel.querySelectorAll('[data-field-row]')){
  const el=form.querySelector('[name="'+row.dataset.fieldRow+'"]');if(!el)continue;
  const value=row.querySelector('.epc-overview-value');if(value){const opt=el.tagName==='SELECT'?el.selectedOptions[0]:null;value.textContent=(opt?.textContent&&el.value?opt.textContent:el.value)||'Niet ingevuld';}
 }};
 for(const label of fields){
  const original=label.querySelector('input[name],select[name],textarea[name]');
  const row=document.createElement('div');row.className='epc-overview-row';row.dataset.fieldRow=original.name;
  const title=document.createElement('strong');title.textContent=label.childNodes[0]?.textContent.trim()||original.name;
  const value=document.createElement('button');value.type='button';value.className='epc-overview-value';
  const editor=document.createElement('div');editor.className='epc-overview-inline hidden';
  value.onclick=()=>{if(active&&active!==editor)active.classList.add('hidden');active=editor;editor.replaceChildren();
   const control=original.cloneNode(true);control.removeAttribute('id');control.disabled=false;control.value=original.value;
   const done=document.createElement('button');done.type='button';done.className='epc-wizard-next';done.textContent='Bevestigen';
   done.onclick=()=>{if(control.type==='number'&&control.value&&!control.checkValidity()){note('Vul een geldig getal in.');return}original.value=control.value;editor.classList.add('hidden');refresh()};
   editor.append(control,done);editor.classList.remove('hidden');control.focus();
  };
  row.append(title,value,editor);panel.append(row);
 }
 const save=document.createElement('button');save.type='button';save.className='epc-overview-save';save.textContent='Wijzigingen opslaan';
 save.onclick=()=>{if(active&&!active.classList.contains('hidden')){note('Bevestig eerst het geopende gegeven.');return}form.requestSubmit()};panel.append(save);
 form.before(panel);refresh();
}
const cf=$('construction-form');
function editConstruction(d){activeConstruction=d||null;cf.reset();$('construction-heading').textContent=d?'Gevelconstructie':'Nieuwe gevelconstructie';show('construction-delete',!!d);if(d){for(const el of cf.elements){if(!el.name)continue;const value=d[el.name];el.value=value===null||value===undefined?'':typeof value==='boolean'?String(value):String(value)}}screen('construction-editor');if(d)wizardStop(cf);else wizardStart(cf,'facade');showConstructionOverview(cf,'construction-editor',!!d);window.scrollTo({top:0,behavior:'instant'})}
$('construction-back').onclick=$('construction-cancel').onclick=()=>{screen('facade-page');loadConstructions()};
$('construction-delete').onclick=async()=>{if(!activeConstruction||!confirm('Gevelconstructie "'+activeConstruction.name+'" verwijderen?'))return;const {error}=await db.from('epc_facade_constructions').update({deleted_at:new Date().toISOString()}).eq('id',activeConstruction.id).eq('facade_id',activeFacade.id).eq('dossier_id',activeDossier.id);if(error)return err(error);activeConstruction=null;screen('facade-page');await loadConstructions();await loadSectionPhotos('facade',activeFacade.id,'facade-page');note('Gevelconstructie verwijderd.')};
cf.onsubmit=async e=>{e.preventDefault();if(!activeDossier||!activeFacade)return;const fd=new FormData(cf), payload={};for(const [key,val] of fd){const v=String(val).trim();payload[key]=v||null}payload.fully_glazed=payload.fully_glazed===null?null:payload.fully_glazed==='true';for(const key of ['insulation_thickness_mm','renovation_reference_year'])payload[key]=payload[key]===null?null:Number(payload[key]);$('construction-save').disabled=true;try{
 const {data:existing,error:lookupError}=await db.from('epc_facade_constructions')
 .select('id,name').eq('dossier_id',activeDossier.id).eq('facade_id',activeFacade.id).is('deleted_at',null);
 if(lookupError)throw lookupError;
 if((existing||[]).some(x=>x.id!==activeConstruction?.id && x.name.trim().toLocaleLowerCase('nl-BE')===String(payload.name||'').trim().toLocaleLowerCase('nl-BE')))
 throw new Error('Deze gevelconstructie is al aan deze gevel toegevoegd.');
 let r;
 if(activeConstruction){
  // De huidige opslagstructuur bevat kopieën per gevel. Werk alle actieve
  // exemplaren met dezelfde oorspronkelijke naam binnen dit dossier bij.
  const {data:all,error:allError}=await db.from('epc_facade_constructions')
    .select('id,name,facade_id').eq('dossier_id',activeDossier.id).is('deleted_at',null);
  if(allError)throw allError;
  const norm=s=>String(s||'').trim().toLocaleLowerCase('nl-BE');
  const originals=(all||[]).filter(x=>norm(x.name)===norm(activeConstruction.name));
  const conflict=(all||[]).some(x=>norm(x.name)===norm(payload.name)&&!originals.some(y=>y.id===x.id));
  if(conflict)throw new Error('Deze naam wordt al gebruikt voor een andere gevelconstructie in dit dossier.');
  const ids=originals.map(x=>x.id);
  if(!ids.includes(activeConstruction.id))throw new Error('Gevelconstructie is niet meer beschikbaar. Vernieuw het overzicht.');
  r=await db.from('epc_facade_constructions').update(payload).in('id',ids)
    .eq('dossier_id',activeDossier.id).is('deleted_at',null).select('id');
  if(!r.error && r.data?.length!==ids.length)throw new Error('Niet alle gevelconstructies konden worden bijgewerkt.');
 }else{
  const {data:allNames,error:namesError}=await db.from('epc_facade_constructions')
   .select('name').eq('dossier_id',activeDossier.id).is('deleted_at',null);
  if(namesError)throw namesError;
  if((allNames||[]).some(x=>x.name.trim().toLocaleLowerCase('nl-BE')===String(payload.name||'').trim().toLocaleLowerCase('nl-BE')))
   throw new Error('Er bestaat al een gevelconstructie met deze naam in dit dossier. Pas de naam aan.');
  r=await db.from('epc_facade_constructions').insert({...payload,dossier_id:activeDossier.id,facade_id:activeFacade.id}).select('id').single();
 }if(r.error)throw r.error;screen('facade-page');await loadConstructions();await loadSectionPhotos('facade',activeFacade.id,'facade-page');note('Gevelconstructie opgeslagen.')}catch(ex){err(ex);if(!activeConstruction){wizardStart(cf,'facade');wizard.index=wizard.steps.indexOf('final_details');wizardRender()}}finally{$('construction-save').disabled=false}};

$('summary-toggle').onclick=()=>{const isOpen=$('summary-content').classList.toggle('hidden')===false;$('summary-toggle').setAttribute('aria-expanded',String(isOpen));$('summary-arrow').textContent=isOpen?'⌃':'⌄'};
$('detail-back').onclick=()=>{closeDrawer();activeDossier=null;screen('home');load();window.scrollTo({top:0,behavior:'instant'})};
$('detail-edit').onclick=()=>{if(activeDossier)edit(activeDossier)};
$('delete-dossier').onclick=async()=>{
 if(!current||!activeDossier||current!==activeDossier.id)return;
 const id=current, number=activeDossier.dossier_number||'';
 if(!window.confirm('Dossier '+number+' verwijderen?\n\nHet dossier verdwijnt uit het overzicht. Deze actie kan niet vanuit EPC Buddy ongedaan worden gemaakt.'))return;
 const button=$('delete-dossier');button.disabled=true;
 try{
  const {data,error}=await db.from('epc_dossiers').update({deleted_at:new Date().toISOString()}).eq('id',id).eq('workspace_id',workspace).is('deleted_at',null).select('id');
  if(error)throw error;
  if(!data?.length)throw new Error('Dossier kon niet worden verwijderd. Controleer je toegangsrechten.');
  activeDossier=null;current=null;closeDrawer();screen('home');await load();note('Dossier '+number+' verwijderd.');
 }catch(e){err(e)}finally{button.disabled=false}
};

const envelopeKinds=new Map([
 ['Hellend dak voor','hellend_dak'],['Hellend dak achter','hellend_dak'],['Hellend dak links','hellend_dak'],['Hellend dak rechts','hellend_dak'],
 ['Plat dak','plat_dak'],['Plafond','plafond'],['Vloer','vloer']
]);
const envelopeForm=$('envelope-form');
const envelopeIcons={hellend_dak:'hdk.svg',plat_dak:'pdk.svg',plafond:'plf.svg',vloer:'vlr.svg'};
function constructionIcon(kind){const img=document.createElement('img');img.src='ico/'+envelopeIcons[kind];img.alt='';img.className='epc-item-icon';return img}
function envelopeKind(){return envelopeKinds.get(activeEnvelope)}
function envelopeLabel(){return envelopeKind()==='hellend_dak'?'hellende-dakconstructie':envelopeKind()==='plat_dak'?'platte-dakconstructie':envelopeKind()==='plafond'?'plafondconstructie':'vloerconstructie'}
async function openEnvelope(name,record){activeEnvelope=name;activeEnvelopeRecord=record;screen('envelope-page');await loadSectionPhotos('envelope',record.id,'envelope-page');$('envelope-page-title').textContent=name;$('envelope-page-icon').replaceChildren(iconFor(name));await loadEnvelopeConstructions();window.scrollTo({top:0,behavior:'instant'})}
async function loadEnvelopeConstructions(){
 if(!activeEnvelopeRecord)return;
 const {data,error}=await db.from('epc_envelope_constructions').select('*').eq('dossier_id',activeDossier.id).eq('envelope_id',activeEnvelopeRecord.id).is('deleted_at',null).order('created_at',{ascending:true});
 if(error)return err(error);
 const host=$('envelope-construction-list');host.replaceChildren();
 for(const d of data||[]){
  const row=document.createElement('div');row.className='construction-list-item';
  const b=document.createElement('button');b.type='button';b.className='construction-row';
  const icon=document.createElement('span');icon.className='construction-icon';icon.append(constructionIcon(envelopeKind()));
  const txt=document.createElement('span');txt.className='facade-text';const strong=document.createElement('strong');strong.textContent=d.name;
  const small=document.createElement('small');small.textContent=envelopeLabel();txt.append(strong,small);
  const arrow=document.createElement('span');arrow.className='row-chevron';arrow.textContent='›';b.append(icon,txt,arrow);b.onclick=()=>envelopeShow(activeEnvelope,d);
  const del=document.createElement('button');del.type='button';del.className='construction-item-delete';del.title='Uit dit onderdeel verwijderen';
  const img=document.createElement('img');img.src='ico/delete.svg';img.alt='';img.className='delete-icon';del.append(img);
  del.onclick=async()=>{if(!confirm(d.name+' uit '+activeEnvelope+' verwijderen? Andere onderdelen blijven behouden.'))return;
   const {error:e}=await db.from('epc_envelope_constructions').update({deleted_at:new Date().toISOString()}).eq('id',d.id).eq('envelope_id',activeEnvelopeRecord.id).eq('dossier_id',activeDossier.id);
   if(e)return err(e);await loadEnvelopeConstructions();note('Constructie verwijderd uit dit onderdeel.')};
  row.append(b,del);host.append(row);
 }
 if(!data?.length){const p=document.createElement('p');p.className='construction-empty';p.textContent='Nog geen constructies toegevoegd.';host.append(p)}
}
$('envelope-page-back').onclick=()=>{screen('detail');loadFacades()};
$('envelope-page-delete').onclick=async()=>{
 if(!activeEnvelopeRecord||!confirm(activeEnvelope+' verwijderen? De gekoppelde constructies worden uit dit onderdeel verwijderd.'))return;
 const stamp=new Date().toISOString();
 const {error:e}=await db.from('epc_envelope_constructions').update({deleted_at:stamp}).eq('envelope_id',activeEnvelopeRecord.id).eq('dossier_id',activeDossier.id).is('deleted_at',null);
 if(e)return err(e);
 const {error}=await db.from('epc_envelope_elements').update({deleted_at:stamp}).eq('id',activeEnvelopeRecord.id).eq('dossier_id',activeDossier.id);
 if(error)return err(error);
 activeEnvelopeRecord=null;screen('detail');await loadFacades();note('Onderdeel verwijderd.');
};
$('envelope-construction-add').onclick=async()=>{
 const {data,error}=await db.from('epc_envelope_constructions').select('*').eq('dossier_id',activeDossier.id).eq('element_kind',envelopeKind()).is('deleted_at',null).order('created_at',{ascending:true});
 if(error)return err(error);
 const host=$('envelope-drawer-items');host.replaceChildren();
 const add=document.createElement('button');add.type='button';add.className='add-option';add.append(constructionIcon(envelopeKind()),document.createTextNode('Nieuwe '+envelopeLabel()));
 add.onclick=()=>{closeEnvelopeDrawer();envelopeShow(activeEnvelope,null)};host.append(add);
 const used=new Set((data||[]).filter(d=>d.envelope_id===activeEnvelopeRecord.id).map(d=>d.name.trim().toLocaleLowerCase('nl-BE')));
 const templates=new Map();for(const d of data||[]){const key=d.name.trim().toLocaleLowerCase('nl-BE');if(!templates.has(key))templates.set(key,d)}
 for(const [key,d] of templates){
  const b=document.createElement('button');b.type='button';b.className='add-option';b.append(constructionIcon(envelopeKind()),document.createTextNode(d.name));
  if(used.has(key)){b.disabled=true;b.classList.add('already-added')}else b.onclick=async()=>{
   b.disabled=true;const fields=['name','boundary','fully_glazed','dormer_count','slope','insulation','insulation_thickness_mm','insulation_interruption','air_layer','floor_heating','element_type','renovation_reference_year','remarks'];
   const payload={dossier_id:activeDossier.id,envelope_id:activeEnvelopeRecord.id,element_kind:envelopeKind()};for(const k of fields)payload[k]=d[k];
   const {error:e}=await db.from('epc_envelope_constructions').insert(payload);if(e){b.disabled=false;return err(e)}
   closeEnvelopeDrawer();await loadEnvelopeConstructions();note('Constructie toegevoegd.');
  };host.append(b);
 }
 show('envelope-overlay');show('envelope-drawer');document.body.classList.add('envelope-drawer-open');
};
function closeEnvelopeDrawer(){show('envelope-overlay',false);show('envelope-drawer',false);document.body.classList.remove('envelope-drawer-open')}
$('envelope-overlay').onclick=$('envelope-drawer-close').onclick=closeEnvelopeDrawer;

function envelopeTypeLabel(name){return name.startsWith('Hellend dak')?'Daktype':name==='Plat dak'?'Daktype':name==='Plafond'?'Plafondtype':'Vloertype'}
function envelopeShow(name,record=null){
 activeEnvelope=name;activeEnvelopeConstruction=record;envelopeForm.reset();const kind=envelopeKind();
 $('envelope-heading').textContent=(record?'':'Nieuwe ')+envelopeLabel();
 $('envelope-icon').replaceChildren(constructionIcon(kind));
 for(const label of envelopeForm.querySelectorAll('[data-kinds]')){
  const visible=label.dataset.kinds.split(' ').includes(kind);label.classList.toggle('hidden',!visible);
  label.querySelectorAll('input,select,textarea').forEach(input=>input.disabled=!visible);
 }
 // Only populate visible/enabled controls: some types intentionally reuse the same DB column.
 if(record)for(const el of envelopeForm.elements){
  if(!el.name||el.disabled||record[el.name]===undefined)continue;
  el.value=record[el.name]===null?'':String(record[el.name]);
 }
 show('envelope-delete',!!record);screen('envelope-editor');if(record)wizardStop(envelopeForm);else wizardStart(envelopeForm,kind);showConstructionOverview(envelopeForm,'envelope-editor',!!record);window.scrollTo({top:0,behavior:'instant'});
}
$('envelope-back').onclick=$('envelope-cancel').onclick=()=>{screen('envelope-page');loadEnvelopeConstructions()};
$('envelope-delete').onclick=async()=>{
 if(!activeEnvelopeConstruction||!confirm('Deze constructie uit '+activeEnvelope+' verwijderen?'))return;
 const {error}=await db.from('epc_envelope_constructions').update({deleted_at:new Date().toISOString()})
 .eq('id',activeEnvelopeConstruction.id).eq('envelope_id',activeEnvelopeRecord.id).eq('dossier_id',activeDossier.id);
 if(error)return err(error);screen('envelope-page');await loadEnvelopeConstructions();note('Constructie verwijderd.');
};
envelopeForm.onsubmit=async e=>{
 e.preventDefault();if(!activeDossier||!activeEnvelopeRecord)return;
 const fd=new FormData(envelopeForm),payload={};for(const [key,val] of fd)payload[key]=String(val).trim()||null;
 for(const key of ['fully_glazed','floor_heating'])if(key in payload)payload[key]=payload[key]===null?null:payload[key]==='true';
 for(const key of ['dormer_count','insulation_thickness_mm','renovation_reference_year'])if(key in payload)payload[key]=payload[key]===null?null:Number(payload[key]);
 payload.dossier_id=activeDossier.id;payload.envelope_id=activeEnvelopeRecord.id;payload.element_kind=envelopeKind();
 const button=$('envelope-save');button.disabled=true;
 try{
  const {data:all,error:lookupError}=await db.from('epc_envelope_constructions').select('id,name,envelope_id').eq('dossier_id',activeDossier.id).eq('element_kind',envelopeKind()).is('deleted_at',null);
  if(lookupError)throw lookupError;
  const norm=s=>String(s||'').trim().toLocaleLowerCase('nl-BE');
  if(!payload.name)throw new Error('Vul een naam in.');
  if(activeEnvelopeConstruction){
   const originals=(all||[]).filter(x=>norm(x.name)===norm(activeEnvelopeConstruction.name));
   if((all||[]).some(x=>norm(x.name)===norm(payload.name)&&!originals.some(y=>y.id===x.id)))throw new Error('Deze naam is al in gebruik.');
   const ids=originals.map(x=>x.id);
   const sharedPayload={...payload};delete sharedPayload.envelope_id;const {data:changed,error}=await db.from('epc_envelope_constructions').update(sharedPayload).in('id',ids).eq('dossier_id',activeDossier.id).select('id');
   if(error)throw error;if(changed.length!==ids.length)throw new Error('Niet alle gekoppelde constructies zijn bijgewerkt.');
  }else{
   if((all||[]).some(x=>norm(x.name)===norm(payload.name)))throw new Error('Er bestaat al een constructie met deze naam in dit dossier. Pas de naam aan.');
   const {error}=await db.from('epc_envelope_constructions').insert(payload);if(error)throw error;
  }
  screen('envelope-page');await loadEnvelopeConstructions();note('Constructie opgeslagen.');
 }catch(ex){err(ex);if(!activeEnvelopeConstruction){wizardStart(envelopeForm,envelopeKind());wizard.index=wizard.steps.indexOf('final_details');wizardRender()}}finally{button.disabled=false}
};
// Installaties: één sectie per type en meerdere items per sectie.
// Formuliervelden komen uit de eerder opgegeven EPC Buddy-specificatie.
// Waar exacte EPC-keuzelijsten niet vastliggen, gebruiken we een tekstveld.
const installationKinds=new Map([['Verwarmingsinstallatie','heating_system'],['Opwekker verwarming','heating'],['Actieve koeling','cooling'],['Opwekker SWW','hot_water'],['Ventilatieruimte','room_ventilation'],['Ventilatie-unit','ventilation_unit'],['Zonneboiler','solar_thermal'],['PV-panelen','pv'],['Verlichting','lighting']]);
const I=(key,label,type='text',options=null)=>({key,label,type,options});
// Centrale formulierdefinities per installatietype. Geen ongeverifieerde EPC-keuzelijsten.
// Eén centrale configuratie per installatietype. Opties zijn uitsluitend afkomstig
// uit de door de gebruiker opgegeven EPC Buddy-specificaties.
// Bij ontbrekende keuzewaarden blijft het veld voorlopig vrij invulbaar.
const installationDefinitions={
 heating_system:[],
 heating:[I('brand','Merk'),I('model','Type / model'),I('year','Referentiejaar fabricage','number'),
  I('generator','Type opwekker','select',['Centraal','Decentraal']),
  I('energy','Energiedrager','select',['Gas','Stookolie','Hout (overig)','Pellets','Kolen','Warmtenet','Elektriciteit']),
  I('label','Label','select',['Afwezig','CE-Keurmerk','Energy Star','HR-top','Blaue Engel','BGV/AGB','HR BVG/AGB','HR+','Optimaz Elite 2005','Optimaz 2005','Optimaz oud','Nordic Swann']),
  I('pump','Pompregeling aanwezig','select',['Ja','Nee','Onbekend']),I('sensor','Buitenvoeler','select',['Aanwezig','Afwezig'])],
 cooling:[I('brand','Merk'),I('model','Type / model'),
  I('cooling','Type actieve koeling','select',['Geen','Onbekend','Onvolledig','Aanwezig']),
  I('generator','Type opwekker','select',['Lucht/Lucht','Water/Lucht','Bodem/Lucht','Lucht/Water','Water/Water','Bodem/Water']),
  I('year','Referentiejaar fabricage','number'),I('refrigerant','Koelmiddel','select',['Onbekend','Gekend'])],
 hot_water:[I('type','Soort SWW','select',['Individueel','Collectief']),
  I('heating','Gekoppeld aan verwarming','heating-link'),I('brand','Merk'),I('model','Type / model'),
  I('year','Referentiejaar fabricage','number'),I('energy','Energiedrager'),
  I('tank','Voorraadvat (L)','number'),I('pipes','Gewone leidingen','select',['< 5 m','≥ 5 m'])],
 ventilation_unit:[I('brand','Merk'),I('model','Type / model'),I('type','Type ventilatie'),I('control','Regeling')],
 room_ventilation:[I('room','Ruimte'),I('room_type','Ruimtetype','select',['Natte ruimte: keuken/bad of douche','Natte ruimte: andere','Verblijfsruimte','Andere']),I('type','Ventilatietype','select',['Geen','Natuurlijke toevoer','Natuurlijke afvoer','Mechanische toevoer','Mechanische afvoer'])],
 solar_thermal:[I('area','Oppervlakte paneel (m²)','number'),I('quantity','Aantal','number'),I('roof','Ligging (dak)','roof-link')],
 pv:[I('area','Oppervlakte paneel (m²)','number'),I('quantity','Aantal','number'),I('roof','Ligging (dak)','roof-link')],
 lighting:[I('source','Type lichtbron'),I('presence','Regeling aan-/afwezigheid'),I('daylight','Regeling i.f.v. daglicht')]
};

function installationInput(def,value){
 const label=document.createElement('label');label.textContent=def.label;let input;
 if(['select','roof-link','heating-link'].includes(def.type)){
  input=document.createElement('select');const blank=document.createElement('option');blank.value='';blank.textContent='Maak een keuze';input.append(blank);
  for(const v of def.options||[]){const option=document.createElement('option');option.value=v;option.textContent=v;input.append(option)}
 }else{input=document.createElement('input');input.type=def.type;if(def.type==='number'){input.min='0';input.step='any';input.inputMode='decimal'}}
 input.name=def.key;
 // Een vroegere waarde niet wissen wanneer de gekoppelde categorie intussen verwijderd is.
 if(value!=null && ![...input.options||[]].some(o=>o.value===String(value)) && input.tagName==='SELECT'){
  const legacy=document.createElement('option');legacy.value=String(value);legacy.textContent=String(value)+' (eerder opgeslagen)';input.append(legacy);
 }
 input.value=value??'';label.append(input);return label;
}
async function openInstallationSection(section){if(section.kind==='hot_water')section={...section,name:'Opwekker SWW'};if(section.kind==='ventilation_unit')section={...section,name:'Ventilatie-unit'};if(section.kind==='room_ventilation')section={...section,name:'Ventilatieruimte'};activeInstallationSection=section;activeInstallation=null;$('installation-title').textContent=section.name;$('installation-icon').replaceChildren(iconFor(section.name));screen('installation-page');await loadInstallationEntries();await loadSectionPhotos('installation',section.id,'installation-page');window.scrollTo({top:0,behavior:'instant'})}
async function loadInstallationEntries(){
 const {data,error}=await db.from('epc_installation_entries').select('*').eq('dossier_id',activeDossier.id).eq('section_id',activeInstallationSection.id).is('deleted_at',null).order('created_at',{ascending:true});
 if(error)return err(error);const host=$('installation-list');host.replaceChildren();
 if(!data?.length){const p=document.createElement('p');p.className='construction-empty';p.textContent='Nog geen installaties toegevoegd.';host.append(p)}
 for(const entry of data||[]){
  const row=document.createElement('div');row.className='construction-list-item';const b=document.createElement('button');b.type='button';b.className='construction-row';
  const icon=document.createElement('span');icon.className='construction-icon';icon.append(iconFor(activeInstallationSection.name));
  const txt=document.createElement('span');txt.className='facade-text';const name=document.createElement('strong');name.textContent=entry.name;const sub=document.createElement('small');sub.textContent=activeInstallationSection.name;txt.append(name,sub);
  const arrow=document.createElement('span');arrow.className='row-chevron';arrow.textContent='›';b.append(icon,txt,arrow);b.onclick=()=>editInstallation(entry);
  const del=document.createElement('button');del.type='button';del.className='construction-item-delete';del.title='Installatie verwijderen';const img=document.createElement('img');img.src='ico/delete.svg';img.className='delete-icon';img.alt='';del.append(img);del.onclick=async()=>{if(!await removeInstallation(entry))return;const {data}=await db.from('epc_installation_sections').select('id').eq('id',activeInstallationSection.id).is('deleted_at',null).maybeSingle();if(!data){activeInstallationSection=null;screen('detail');await loadFacades()}};
  row.append(b,del);host.append(row);
 }
}
async function checkInstallationPrerequisite(kind){
 if(!['heating_system','ventilation_unit'].includes(kind))return true;
 const required=kind==='heating_system'?'heating':'room_ventilation';
 const {data:sections,error}=await db.from('epc_installation_sections').select('id').eq('dossier_id',activeDossier.id).eq('kind',required).is('deleted_at',null);
 if(error){err(error);return false}
 if(!sections?.length){note(kind==='heating_system'?'Voeg eerst het onderdeel Opwekker verwarming toe en maak minstens één opwekker aan.':'Voeg eerst Ventilatieruimte toe en maak minstens één ruimte met Mechanisch, permanent aan.');return false}
 const {data:entries,error:e}=await db.from('epc_installation_entries').select('id,details').eq('dossier_id',activeDossier.id).in('section_id',sections.map(x=>x.id)).is('deleted_at',null);
 if(e){err(e);return false}
 const valid=kind==='heating_system'?!!entries?.length:(entries||[]).some(x=>x.details?.type==='Mechanisch, permanent');
 if(!valid)note(kind==='heating_system'?'Maak eerst minstens één opwekker verwarming aan.':'Maak eerst minstens één ventilatieruimte met Mechanisch, permanent aan.');
 return valid;
}
async function editInstallation(entry=null){
 if(entry){return openInstallationOverview(entry)}
 if(activeInstallationSection.kind==='lighting'&&dossierType(activeDossier)==='RES'){note('Verlichting is enkel beschikbaar voor GD en kNR.');return}
 if(!(await checkInstallationPrerequisite(activeInstallationSection.kind)))return;
 if(['heating','heating_system'].includes(activeInstallationSection.kind)){return startHeatingWizard(null)}
 if(activeInstallationSection.kind==='cooling'){return startCoolingWizard()}
 if(activeInstallationSection.kind==='hot_water'){return startSwwWizard()}
 if(['solar_thermal','pv','lighting'].includes(activeInstallationSection.kind)){return startSimpleInstallationWizard()}
 if(['room_ventilation','ventilation_unit'].includes(activeInstallationSection.kind))return startVentilationWizard();
 activeInstallation=entry;const form=$('installation-form');form.reset();$('installation-edit-title').textContent=entry?activeInstallationSection.name:'Nieuwe '+activeInstallationSection.name.toLocaleLowerCase('nl-BE');$('installation-edit-icon').replaceChildren(iconFor(activeInstallationSection.name));
 form.elements.namedItem('name').value=entry?.name||'';form.elements.namedItem('remarks').value=entry?.remarks||'';
 const host=$('installation-fields');host.replaceChildren();
 let roofNames=[];let heatingNames=['Zelfstandig systeem'];
 if(['solar_thermal','pv'].includes(activeInstallationSection.kind)){
  const {data,error}=await db.from('epc_envelope_elements').select('name').eq('dossier_id',activeDossier.id).is('deleted_at',null);
  if(error)return err(error);
  roofNames=(data||[]).filter(x=>x.name.startsWith('Hellend dak')||x.name==='Plat dak').map(x=>x.name);
  roofNames.push('Dak buiten beschermd volume');
 }
 if(activeInstallationSection.kind==='hot_water'){
  const {data:sections,error}=await db.from('epc_installation_sections').select('id').eq('dossier_id',activeDossier.id).eq('kind','heating').is('deleted_at',null);
  if(error)return err(error);
  if(sections?.length){const {data:heaters,error:heatingError}=await db.from('epc_installation_entries').select('name').eq('dossier_id',activeDossier.id).eq('section_id',sections[0].id).is('deleted_at',null);
   if(heatingError)return err(heatingError);heatingNames=(heaters||[]).map(x=>x.name)}
 }
 for(const def of installationDefinitions[activeInstallationSection.kind]||[]){
  const configured=def.type==='roof-link'?{...def,options:roofNames}:def.type==='heating-link'?{...def,options:heatingNames}:def;
  host.append(installationInput(configured,entry?.details?.[def.key]));
 }
 show('installation-delete',!!entry);screen('installation-editor');window.scrollTo({top:0,behavior:'instant'});
}
// Bestaande installaties openen altijd in één overzicht; de wizard is alleen voor nieuwe items.
let installationOverview=null;
async function openInstallationOverview(entry){
 activeInstallation=entry;heatingWizard=null;coolingWizard=null;swwWizard=null;
 const kind=activeInstallationSection.kind;
 const generators=[];
 if(['heating_system','hot_water'].includes(kind)){
  const linkKind=kind==='hot_water'?'heating_system':'heating';
  const {data:sections,error}=await db.from('epc_installation_sections').select('id').eq('dossier_id',activeDossier.id).eq('kind',linkKind).is('deleted_at',null);
  if(error)return err(error);
  for(const section of sections||[]){const {data,error:e}=await db.from('epc_installation_entries').select('id,name').eq('dossier_id',activeDossier.id).eq('section_id',section.id).is('deleted_at',null);if(e)return err(e);generators.push(...(data||[]))}
 }
 let ventRooms=[];
 if(kind==='ventilation_unit')ventRooms=await fetchVentRooms();
 let roofs=[];if(['solar_thermal','pv'].includes(kind))roofs=await fetchSolarRoofs();
 installationOverview={entry,systems:generators,ventRooms,values:{...(entry.details||{}),name:entry.name,remarks:entry.remarks||''},generators:generators.map(x=>x.name),roofs,editing:null};
 $('installation-edit-title').textContent=entry.name;
 $('installation-edit-icon').replaceChildren(iconFor(activeInstallationSection.name));
 show('installation-form',false);show('installation-wizard',true);
 screen('installation-editor');renderInstallationOverview();
}
function overviewFields(){
 const o=installationOverview,kind=activeInstallationSection.kind;
 if(kind==='hot_water'){
  const v=o.values,fields=[{key:'name',title:'Naamgeving'},{key:'type',title:'Soort SWW',choices:['Individueel','Collectief']}];
  if(v.type==='Individueel')fields.push({key:'heating',title:'Verwarmingsinstallatie',choices:['Los van CV',...o.generators]});
  if(v.type==='Collectief'||v.heating==='Los van CV'||!v.heating){
   fields.push({key:'energy',title:'Energiedrager',choices:['Gas','Stookolie','Elektriciteit']});
   if(['Gas','Elektriciteit'].includes(v.energy))fields.push({key:'sww_generator',title:'Type opwekker',choices:v.energy==='Gas'?['WP boiler','Ketel']:['WP boiler','Elektrische weerstandsverwarming']});
  }
  fields.push({key:'tank_present',title:'Voorraadvat',choices:['Nee','Ja']});
  if(v.tank_present==='Ja'){
   fields.push({key:'tank_method',title:'Volumebepaling',choices:['Omtrek + hoogte','Volume invoer']});
   if(v.tank_method==='Omtrek + hoogte')fields.push({key:'tank_circumference',title:'Omtrek (cm)'},{key:'tank_height',title:'Hoogte (cm)'});
   if(v.tank_method==='Volume invoer')fields.push({key:'tank',title:'Volume (liter)'});
   fields.push({key:'tank_insulation',title:'Isolatie voorraadvat',choices:['Nee','Ja','Onbekend']});
  }
  fields.push({key:'pipes_type',title:'Leidingen',choices:['Circulatieleidingen','Gewone leidingen']});
  if(v.pipes_type==='Circulatieleidingen')fields.push({key:'pipes_insulation',title:'Isolatie leidingen',choices:['Geïsoleerd','Niet geïsoleerd','Onbekend']});
  if(v.pipes_type==='Gewone leidingen')fields.push({key:'pipes_length',title:'Leidinglengte',choices:['> 5 m','≤ 5 m']});
  fields.push({key:'remarks',title:'Opmerking'});return fields;
 }
 if(kind==='room_ventilation'){
  const v=o.values;return [{key:'name',title:'Naamgeving'},{key:'room',title:'Ruimte',choices:VENT_ROOMS},...(v.room==='Andere'?[{key:'custom_room',title:'Andere ruimte',type:'text'}]:[]),
   {key:'room_type',title:'Ruimtetype',choices:['Natte ruimte','Droge ruimte']},
   {key:'type',title:v.room_type==='Natte ruimte'?'Afvoer':'Toevoer',choices:v.room_type==='Natte ruimte'?VENT_WET:VENT_DRY}];
 }
 if(kind==='ventilation_unit')return [{key:'name',title:'Naamgeving'},{key:'brand',title:'Merk'},{key:'model',title:'Type / model'},
  {key:'scope',title:'Individueel / collectief',choices:['Individueel','Collectief']},
  {key:'type',title:'Ventilatie',choices:['Toevoer en afvoer','Enkel toevoer','Enkel afvoer']},
  {key:'control',title:'Regeling',choices:VENT_CONTROLS},
  {key:'served_rooms',title:'Bediende ventilatieruimtes',type:'vent-rooms'}, {key:'remarks',title:'Opmerking'}];
 if(kind==='cooling'){
  const t=dossierType(activeDossier),v=o.values;
  const fields=[{key:'name',title:'Naamgeving'}];
  if(t==='kNR'){fields.push({key:'cooling',title:'Type actieve koeling',choices:COOL_TYPES},{key:'generator',title:'Type opwekker',choices:COOL_GENERATORS},{key:'refrigerant',title:'Koelmiddel',choices:['Onbekend','Gekend']});if(v.refrigerant==='Gekend')fields.push({key:'refrigerant_type',title:'Type koelmiddel'});}
  if(t==='RES')fields.push({key:'rooms',title:'Direct gekoelde ruimtes',type:'cooling-rooms'});
  fields.push({key:'brand',title:'Merk'},{key:'model',title:'Type / model'});
  if(t==='kNR')fields.push({key:'year',title:'Referentiejaar fabricage'});
  fields.push({key:'remarks',title:'Opmerking'});return fields;
 }
 if(['heating','heating_system'].includes(kind)){
  const old=heatingWizard;
  heatingWizard={kind,values:o.values,generators:o.generators};
  const steps=heatingSteps();heatingWizard=old;
  const fields=[];
  for(const step of steps){
   if(step.key==='device_details'){
    for(const [key,title] of [['brand','Merk'],['model','Type / model'],['year','Referentiejaar fabricage'],['remarks','Opmerking']])fields.push({key,title});
   }else fields.push(step);
  }
  return fields;
 }
 return [{key:'name',title:'Naam'},...(installationDefinitions[kind]||[]).map(d=>({key:d.key,title:d.label,choices:d.type==='roof-link'?o.roofs:d.options,type:d.type})),{key:'remarks',title:'Opmerking'}];
}
function renderInstallationOverview(){
 const o=installationOverview;if(!o)return;
 const host=$('installation-wizard');host.replaceChildren();
 const root=document.createElement('div');root.className='epc-installation-overview';
 const intro=document.createElement('p');intro.className='epc-overview-hint';intro.textContent='Tik op een gegeven om het te bekijken of aan te passen.';root.append(intro);
 const fields=overviewFields();
 // De naam is ook bij verwarmingswizards afzonderlijk bewerkbaar.
 if(!fields.some(x=>x.key==='name'))fields.unshift({key:'name',title:'Naamgeving'});
 for(const field of fields){
  const row=document.createElement('div');row.className='epc-overview-field';
  const label=document.createElement('div');label.className='epc-overview-label';label.textContent=field.title;row.append(label);
  const value=o.values[field.key];
  const button=document.createElement('button');button.type='button';button.className='epc-overview-value';
  const shown=value===undefined||value===null||value===''?'Niet ingevuld':field.type==='vent-rooms'&&Array.isArray(value)?value.map(id=>o.ventRooms?.find(r=>r.id===id)?.name||id).join(', ')||'Geen':Array.isArray(value)?value.join(', '):String(value);
  const span=document.createElement('span');span.textContent=shown;
  const arrow=document.createElement('span');arrow.className='row-chevron';arrow.textContent='›';button.append(span);
  button.onclick=()=>{o.editing=o.editing===field.key?null:field.key;renderInstallationOverview()};row.append(button);
  if(o.editing===field.key){
   const editor=document.createElement('div');editor.className='epc-overview-editor';
   let control;
   const choices=field.choices;
   if(field.type==='vent-rooms'){
    control=document.createElement('div');control.className='epc-overview-choices';
    const draftRooms=new Set(Array.isArray(value)?value:[]);
    for(const room of o.ventRooms||[]){const b=document.createElement('button');b.type='button';b.className='epc-wizard-choice'+((Array.isArray(value)&&value.includes(room.id))?' selected':'');b.textContent=room.name;b.onclick=()=>{draftRooms.has(room.id)?draftRooms.delete(room.id):draftRooms.add(room.id);b.classList.toggle('selected',draftRooms.has(room.id))};control.append(b)}
    editor.append(control);const done=document.createElement('button');done.type='button';done.className='epc-wizard-next';done.textContent='Bevestigen';done.onclick=()=>{o.values.served_rooms=[...draftRooms];o.editing=null;renderInstallationOverview()};editor.append(done);
   }else if(field.type==='cooling-rooms'){
    control=buildCoolingRoomPicker(Array.isArray(value)?value:[],selected=>{o.values.rooms=selected;o.editing=null;renderInstallationOverview()});editor.append(control);
   }else if(Array.isArray(choices)&&choices.length){
    control=document.createElement('div');control.className='epc-overview-choices';
    for(const choice of choices){const b=document.createElement('button');b.type='button';b.className='epc-wizard-choice'+(String(value??'')===String(choice)?' selected':'');b.textContent=HW_SHORT[choice]||choice;b.title=choice;
     b.onclick=()=>{for(const tile of control.querySelectorAll('.epc-wizard-choice'))tile.classList.remove('selected');b.classList.add('selected');editor.dataset.draftChoice=choice};control.append(b)}
    const confirmChoice=document.createElement('button');confirmChoice.type='button';confirmChoice.className='epc-wizard-next';confirmChoice.textContent='Bevestigen';confirmChoice.onclick=()=>{if(!Object.prototype.hasOwnProperty.call(editor.dataset,'draftChoice')){o.editing=null;renderInstallationOverview();return}const choice=editor.dataset.draftChoice;if(activeInstallationSection.kind==='hot_water'&&o.values[field.key]!==choice){
      if(field.key==='type')for(const k of ['heating','energy','sww_generator','heating_system_id'])delete o.values[k];
      if(field.key==='heating'){delete o.values.heating_system_id;delete o.values.energy;delete o.values.sww_generator}
      if(field.key==='energy')delete o.values.sww_generator;
      if(field.key==='tank_present'&&choice==='Nee')for(const k of ['tank_method','tank','tank_circumference','tank_height','tank_insulation'])delete o.values[k];
      if(field.key==='tank_method')for(const k of ['tank','tank_circumference','tank_height'])delete o.values[k];
      if(field.key==='pipes_type'){delete o.values.pipes_insulation;delete o.values.pipes_length}
     }if(activeInstallationSection.kind==='room_ventilation'&&field.key==='room'){o.values.room_type=VENT_WET_ROOMS.includes(choice)?'Natte ruimte':choice==='Andere'?'': 'Droge ruimte';delete o.values.type;if(choice!=='Andere')delete o.values.custom_room;}if(activeInstallationSection.kind==='room_ventilation'&&field.key==='room_type')delete o.values.type;o.values[field.key]=choice;o.editing=null;renderInstallationOverview()};editor.append(confirmChoice);
   }else{
    const def=(installationDefinitions[activeInstallationSection.kind]||[]).find(d=>d.key===field.key);
    if(def&&['select','roof-link','heating-link'].includes(def.type)){
     control=document.createElement('select');control.className='epc-wizard-input';
     const opts=[...(def.options||[])];if(value&&!opts.includes(value))opts.push(value);
     for(const option of ['',...opts]){const el=document.createElement('option');el.value=option;el.textContent=option||'Maak een keuze';control.append(el)}
    }else{control=document.createElement(field.key==='remarks'?'textarea':'input');control.className='epc-wizard-input';if(field.key==='year'||def?.type==='number')control.type='number'}
    control.value=value??'';editor.append(control);
    const apply=document.createElement('button');apply.type='button';apply.className='epc-wizard-next';apply.textContent='Bevestigen';apply.onclick=()=>{const v=control.value.trim();if(field.key==='name'&&!v){note('Vul een naam in.');control.focus();return}o.values[field.key]=v;o.editing=null;renderInstallationOverview()};editor.append(apply);
   }
   if(Array.isArray(choices)&&choices.length)editor.append(control);
   const cancel=document.createElement('button');cancel.type='button';cancel.className='secondary';cancel.textContent='Annuleren';cancel.onclick=()=>{o.editing=null;renderInstallationOverview()};editor.append(cancel);row.append(editor);
  }
  root.append(row);
 }
 const save=document.createElement('button');save.type='button';save.className='epc-wizard-next epc-overview-save';save.textContent='Wijzigingen opslaan';save.onclick=saveInstallationOverview;root.append(save);
 host.append(root);
}
async function saveInstallationOverview(){
 const o=installationOverview;if(!o)return;
 if(o.editing){note('Bevestig eerst het geopende gegeven of sluit het zonder te bewaren.');return}
 const name=String(o.values.name||'').trim();if(!name){note('Vul een naam in.');return}
 const {data:duplicates,error:checkError}=await db.from('epc_installation_entries').select('id,name').eq('dossier_id',activeDossier.id).eq('section_id',activeInstallationSection.id).is('deleted_at',null);
 if(checkError)return err(checkError);
 if((duplicates||[]).some(x=>x.id!==o.entry.id&&x.name.toLocaleLowerCase('nl-BE')===name.toLocaleLowerCase('nl-BE'))){note('Deze naam bestaat al. Kies een andere naam.');return}
 const {name:ignored,remarks,...details}=o.values;
 const {error}=await db.from('epc_installation_entries').update({name,remarks:remarks||null,details}).eq('id',o.entry.id).eq('dossier_id',activeDossier.id).eq('section_id',activeInstallationSection.id);
 if(error)return err(error);
 installationOverview=null;show('installation-wizard',false);show('installation-form',true);screen('installation-page');await loadInstallationEntries();note('Installatie opgeslagen.');
}
// Verwijderafhankelijkheden vooraf controleren en uitsluitend na bevestiging verwerken.
async function linkedDeletionPlan(entryIds){
 const {data:sections,error:se}=await db.from('epc_installation_sections').select('id,kind').eq('dossier_id',activeDossier.id).is('deleted_at',null);
 if(se)throw se;
 const {data:entries,error:ee}=await db.from('epc_installation_entries').select('id,section_id,name,details').eq('dossier_id',activeDossier.id).is('deleted_at',null);
 if(ee)throw ee;
 const kinds=new Map((sections||[]).map(x=>[x.id,x.kind]));
 const all=entries||[], deleted=new Set(entryIds), updated=new Map();
 let changed=true;
 while(changed){
  changed=false;
  for(const e of all){
   if(deleted.has(e.id))continue;
   const kind=kinds.get(e.section_id),d=e.details||{};
   if(kind==='heating_system'&&all.some(x=>deleted.has(x.id)&&kinds.get(x.section_id)==='heating'&&(
      [d.generator_id,d.heating_generator_id,d.opwekker_id,d.opwekkerId].includes(x.id)||
      [d.generator_link,d.generator,d.opwekker,d.heating_generator].includes(x.name)))){
    deleted.add(e.id);changed=true;continue;
   }
   if(kind==='hot_water'&&all.some(x=>deleted.has(x.id)&&kinds.get(x.section_id)==='heating_system'&&(
      d.heating_system_id===x.id||d.heating===x.name||d.heating_system===x.name))){deleted.add(e.id);changed=true;continue}
   if(kind==='ventilation_unit'&&Array.isArray(d.served_rooms)){
    const remaining=d.served_rooms.filter(id=>!deleted.has(id));
    if(remaining.length!==d.served_rooms.length){
     if(!remaining.length){deleted.add(e.id);updated.delete(e.id);changed=true}
     else updated.set(e.id,{...d,served_rooms:remaining});
    }
   }
  }
 }
 return {deleted:[...deleted],updated:[...updated].filter(([id])=>!deleted.has(id)),entries:all,kinds};
}
async function executeLinkedDeletion(plan){
 const stamp=new Date().toISOString();
 // Eerst afhankelijke records verwijderen. Zo blijven geen verwijzingen achter.
 const priority={hot_water:0,ventilation_unit:0,heating_system:1,heating:2,room_ventilation:2};
 const ordered=plan.deleted.slice().sort((a,b)=>{
  const x=plan.entries.find(e=>e.id===a),y=plan.entries.find(e=>e.id===b);
  return (priority[plan.kinds.get(x?.section_id)]??3)-(priority[plan.kinds.get(y?.section_id)]??3);
 });
 for(const id of ordered){const {error}=await db.from('epc_installation_entries').update({deleted_at:stamp}).eq('id',id).eq('dossier_id',activeDossier.id).is('deleted_at',null);if(error)throw error}
 for(const [id,details] of plan.updated){const {error}=await db.from('epc_installation_entries').update({details}).eq('id',id).eq('dossier_id',activeDossier.id).is('deleted_at',null);if(error)throw error}
 // Verwijder alleen containers die door deze actie hun laatste installatie verliezen.
 // Containers die al leeg waren, blijven onaangeroerd.
 const affectedSections=[...new Set(plan.entries.filter(e=>plan.deleted.includes(e.id)).map(e=>e.section_id))];
 for(const sectionId of affectedSections){
  const {data:remaining,error:remainingError}=await db.from('epc_installation_entries')
   .select('id').eq('dossier_id',activeDossier.id).eq('section_id',sectionId)
   .is('deleted_at',null).limit(1);
  if(remainingError)throw remainingError;
  if(!remaining?.length){
   const {error:sectionError}=await db.from('epc_installation_sections')
    .update({deleted_at:stamp}).eq('id',sectionId).eq('dossier_id',activeDossier.id).is('deleted_at',null);
   if(sectionError)throw sectionError;
  }
 }
}
async function removeInstallation(entry){
 try{
  const plan=await linkedDeletionPlan([entry.id]);
  const extras=plan.deleted.filter(id=>id!==entry.id).map(id=>plan.entries.find(e=>e.id===id)?.name).filter(Boolean);
  const changes=plan.updated.length;
  const sourceKind=plan.kinds.get(entry.section_id);
  const affected=plan.deleted.filter(id=>id!==entry.id).map(id=>plan.entries.find(e=>e.id===id)).filter(Boolean);
  let warning='';
  if(sourceKind==='room_ventilation'){
   warning=affected.filter(e=>plan.kinds.get(e.section_id)==='ventilation_unit').map(e=>'Na verwijdering van deze ruimte zal ventilatie-unit "'+e.name+'" ook verwijderd worden omdat deze dan geen gekoppelde ruimtes meer heeft.').join('\n');
  }else if(sourceKind==='heating'){
   const systems=affected.filter(e=>plan.kinds.get(e.section_id)==='heating_system');
   const other=affected.filter(e=>plan.kinds.get(e.section_id)!=='heating_system');
   warning=systems.map(e=>'Na verwijdering van deze opwekker zal verwarmingsinstallatie "'+e.name+'" ook verwijderd worden omdat deze dan geen gekoppelde opwekker meer heeft.').join('\n');
   if(other.length)warning+=(warning?'\n\n':'')+'Ook deze afhankelijke installaties worden verwijderd:\n• '+other.map(e=>e.name).join('\n• ');
  }else if(affected.length){
   warning='Ook deze afhankelijke installaties worden verwijderd omdat hun koppeling niet meer bestaat:\n• '+affected.map(e=>e.name).join('\n• ');
  }
  if(warning)warning='\n\n'+warning;
  const updateWarning='';
  if(!confirm('Installatie "'+entry.name+'" verwijderen?'+warning+updateWarning+'\n\nDeze actie kan niet ongedaan worden gemaakt.'))return false;
  await executeLinkedDeletion(plan);await loadInstallationEntries();note('Installatie en eventuele afhankelijke onderdelen verwijderd.');return true;
 }catch(error){err(error);return false}
}
$('installation-back').onclick=()=>{screen('detail');loadFacades()};
$('installation-section-delete').onclick=async()=>{
 try{
  const {data,error}=await db.from('epc_installation_entries').select('id').eq('section_id',activeInstallationSection.id).eq('dossier_id',activeDossier.id).is('deleted_at',null);
  if(error)throw error;
  const plan=await linkedDeletionPlan((data||[]).map(x=>x.id));
  const dependent=plan.deleted.length-(data||[]).length;
  if(!confirm(activeInstallationSection.name+' verwijderen, inclusief alle bijbehorende installaties?'+(dependent>0?'\n\nOok '+dependent+' gekoppelde installatie(s) worden verwijderd.':'')+'\n\nDeze actie kan niet ongedaan worden gemaakt.'))return;
  await executeLinkedDeletion(plan);
  const {error:sectionError}=await db.from('epc_installation_sections').update({deleted_at:new Date().toISOString()}).eq('id',activeInstallationSection.id).eq('dossier_id',activeDossier.id).is('deleted_at',null);if(sectionError)throw sectionError;
  activeInstallationSection=null;screen('detail');await loadFacades();note('Onderdeel verwijderd.');
 }catch(error){err(error)}
};
$('installation-add').onclick=()=>editInstallation(null);
$('installation-edit-back').onclick=$('installation-cancel').onclick=()=>{ventilationWizard=null;installationOverview=null;heatingWizard=null;coolingWizard=null;swwWizard=null;simpleInstallationWizard=null;show('installation-wizard',false);show('installation-form',true);screen('installation-page');loadInstallationEntries()};
$('installation-delete').onclick=async()=>{if(activeInstallation&&await removeInstallation(activeInstallation)){const {data}=await db.from('epc_installation_sections').select('id').eq('id',activeInstallationSection.id).is('deleted_at',null).maybeSingle();if(data){screen('installation-page')}else{activeInstallationSection=null;screen('detail');await loadFacades()}}};
$('installation-form').onsubmit=async event=>{
 event.preventDefault();const form=$('installation-form'),fd=new FormData(form),details={};for(const def of installationDefinitions[activeInstallationSection.kind]||[])details[def.key]=fd.get(def.key)||null;
 const payload={dossier_id:activeDossier.id,section_id:activeInstallationSection.id,name:String(fd.get('name')||'').trim(),remarks:String(fd.get('remarks')||'').trim()||null,details};
 const button=$('installation-save');button.disabled=true;try{
  const query=db.from('epc_installation_entries');const {error}=activeInstallation?await query.update(payload).eq('id',activeInstallation.id).eq('section_id',activeInstallationSection.id):await query.insert(payload);
  if(error)throw error;screen('installation-page');await loadInstallationEntries();await loadSectionPhotos('installation',activeInstallationSection.id,'installation-page');note('Installatie opgeslagen.');
 }catch(ex){err(ex)}finally{button.disabled=false}
};

const addItems=[['Voorgevel','facade'],['Achtergevel','facade'],['Linkergevel','facade'],['Rechtergevel','facade'],['Hellend dak voor','other'],['Hellend dak achter','other'],['Hellend dak links','other'],['Hellend dak rechts','other'],['Plat dak','other'],['Plafond','other'],['Vloer','other'],['Opwekker verwarming','other'],['Verwarmingsinstallatie','other'],['Actieve koeling','other'],['Opwekker SWW','other'],['Ventilatieruimte','other'],['Ventilatie-unit','other'],['Zonneboiler','other'],['PV-panelen','other'],['Verlichting','other']];
function closeDrawer(){closeConstructionDrawer();show('add-drawer',false);show('add-overlay',false);document.body.classList.remove('drawer-open')}
$('detail-add').onclick=async()=>{if(!activeDossier)return;const {data,error}=await db.from('epc_facades').select('name').eq('dossier_id',activeDossier.id).is('deleted_at',null);if(error)return err(error);const existing=new Set((data||[]).map(x=>x.name.toLocaleLowerCase()));
 const {data:existingEnvelope,error:envelopeError}=await db.from('epc_envelope_elements')
 .select('name').eq('dossier_id',activeDossier.id).is('deleted_at',null);
 if(envelopeError)return err(envelopeError);
 const envelopeNames=new Set((existingEnvelope||[]).map(x=>x.name.toLocaleLowerCase('nl-BE')));
 const {data:installedSections,error:installedError}=await db.from('epc_installation_sections').select('name,kind').eq('dossier_id',activeDossier.id).is('deleted_at',null);
 if(installedError)return err(installedError);
 const installedNames=new Set((installedSections||[]).map(x=>x.name.toLocaleLowerCase('nl-BE')));
 if((installedSections||[]).some(x=>x.kind==='hot_water'))installedNames.add('opwekker sww');if((installedSections||[]).some(x=>x.kind==='room_ventilation'))installedNames.add('ventilatieruimte');if((installedSections||[]).some(x=>x.kind==='ventilation_unit'))installedNames.add('ventilatie-unit');
 const host=$('add-options');host.replaceChildren();for(const [name,type] of addItems){const b=document.createElement('button');b.type='button';b.className='add-option';b.append(iconFor(name),document.createTextNode(name));if((type==='facade'&&existing.has(name.toLocaleLowerCase()))||(envelopeKinds.has(name)&&envelopeNames.has(name.toLocaleLowerCase('nl-BE')))||(installationKinds.has(name)&&installedNames.has(name.toLocaleLowerCase('nl-BE')))){b.disabled=true;b.title='Deze gevel bestaat al';b.classList.add('already-added')}b.onclick=async()=>{if(envelopeKinds.has(name)){
  b.disabled=true;const {data:created,error:e}=await db.from('epc_envelope_elements').insert({dossier_id:activeDossier.id,element_kind:envelopeKinds.get(name),name}).select('*').single();
  if(e){b.disabled=false;return err(e)}closeDrawer();await loadFacades();await openEnvelope(name,created);note(name+' toegevoegd.');return;
 }
 if(installationKinds.has(name)){
  if(!(await checkInstallationPrerequisite(installationKinds.get(name))))return;
  b.disabled=true;const {data:created,error:e}=await db.from('epc_installation_sections').insert({dossier_id:activeDossier.id,name,kind:installationKinds.get(name)}).select('*').single();
  if(e){b.disabled=false;return err(e)}closeDrawer();await loadFacades();await openInstallationSection(created);note(name+' toegevoegd.');return;
 }
 if(type!=='facade'){note('Dit onderdeel wordt in de volgende ontwikkelfase toegevoegd.');return}b.disabled=true;const r=await db.from('epc_facades').insert({dossier_id:activeDossier.id,name}).select('*').single();if(r.error){err(r.error);b.disabled=false;return}closeDrawer();await loadFacades();await openFacade(r.data);note(name+' toegevoegd.')};host.append(b)}show('add-overlay');show('add-drawer');document.body.classList.add('drawer-open')};
$('close-drawer').onclick=$('add-overlay').onclick=closeDrawer;
// Detecteer scrollen ook binnen een formulier/scrollcontainer, niet enkel window.
function scrollPosition(){
 const active=[window.scrollY,document.documentElement.scrollTop,document.body.scrollTop];
 for(const el of document.querySelectorAll('main, main section:not(.hidden)'))active.push(el.scrollTop||0);
 return Math.max(...active);
}

// Foto's horen bij het onderdeel (gevel, dak/vloer of installatiecategorie),
// niet bij een afzonderlijke constructie. Opslag: privé Supabase Storage.
const PHOTO_BUCKET='epc-buddy-photos';
const photoTargets={
 'construction-add':()=>activeFacade&&{kind:'facade',id:activeFacade.id,name:activeFacade.name,page:'facade-page'},
 'envelope-construction-add':()=>activeEnvelopeRecord&&{kind:'envelope',id:activeEnvelopeRecord.id,name:activeEnvelope,page:'envelope-page'},
 'installation-add':()=>activeInstallationSection&&{kind:'installation',id:activeInstallationSection.id,name:activeInstallationSection.name,page:'installation-page'}
};
// Ref-counted loader: parallel requests mogen elkaars overlay niet te vroeg sluiten.
let epcLoadingCount=0,epcLoadingTimer=null;
function beginEpcLoading(message='Even geduld…'){
 epcLoadingCount++;$('epc-loading-text').textContent=message;
 clearTimeout(epcLoadingTimer);
 // Snelle acties tonen geen flitsende overlay.
 epcLoadingTimer=setTimeout(()=>{if(epcLoadingCount>0)show('epc-loading',true)},240);
}
function endEpcLoading(){
 epcLoadingCount=Math.max(0,epcLoadingCount-1);
 if(epcLoadingCount===0){clearTimeout(epcLoadingTimer);show('epc-loading',false)}
}
let photoUploadBusy=false;
const photoInput=$('epc-camera-input');
for(const button of document.querySelectorAll('[data-photo-for]')){
 button.onclick=()=>{const target=photoTargets[button.dataset.photoFor]?.();if(!target)return;
  photoInput.dataset.target=button.dataset.photoFor;photoInput.value='';photoInput.click();
 };
}
function photoBase(name){
 // Exacte leesbare naam: pic_Voorgevel_001.jpg / pic_Opwekker_verwarming_001.jpg
 return 'pic_'+String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[^a-zA-Z0-9]+/g,'_').replace(/^_+|_+$/g,'');
}
// Fotogalerij: 1 databaseaanvraag + 1 batchaanvraag voor alle tijdelijke foto-URL's.
// Geen serieel wachten per thumbnail: dat vertraagde de mobiele weergave sterk.
const epcPhotoCache=new Map();
const epcPhotoLoads=new Map();
function formatPhotoTimestamp(value){
 if(!value)return 'Datum onbekend';
 const d=new Date(value);return Number.isNaN(d.getTime())?'Datum onbekend':
  new Intl.DateTimeFormat('nl-BE',{dateStyle:'short',timeStyle:'short'}).format(d);
}
async function loadSectionPhotos(kind,targetId,page,{force=false}={}){
 if(!activeDossier)return;
 const host=$(page+'-photos');if(!host)return;
 const dossierId=activeDossier.id,cacheKey=`${dossierId}:${kind}:${targetId}`;
 // Clear stale thumbnails immediately, even before cached/remote data arrives.
 host.replaceChildren();
 const existing=epcPhotoCache.get(cacheKey);
 if(existing && !force && existing.expires>Date.now()){
  renderSectionPhotos(host,existing.photos,kind,targetId,page,dossierId);return;
 }
 // Vermijd dubbele netwerkverzoeken bij snel terug- en vooruitnavigeren.
 if(epcPhotoLoads.has(cacheKey))return epcPhotoLoads.get(cacheKey);
 const task=(async()=>{
  beginEpcLoading('Foto’s ophalen…');
  try{
   const {data,error}=await db.from('epc_section_photos')
    .select('id,filename,storage_path,created_at')
    .eq('dossier_id',dossierId).eq('section_kind',kind).eq('section_id',targetId)
    .is('deleted_at',null).order('created_at',{ascending:true});
   if(error)throw error;
   const photos=data||[];
   if(photos.length){
    const {data:urls,error:signError}=await db.storage.from(PHOTO_BUCKET)
      .createSignedUrls(photos.map(p=>p.storage_path),600);
    if(signError)throw signError;
    const urlByPath=new Map((urls||[]).map((u,i)=>[photos[i].storage_path,u.signedUrl]));
    for(const photo of photos)photo.url=urlByPath.get(photo.storage_path);
   }
   epcPhotoCache.set(cacheKey,{photos,expires:Date.now()+8*60*1000});
   if(activeDossier?.id===dossierId &&
      ((kind==='facade'&&activeFacade?.id===targetId)||
       (kind==='envelope'&&activeEnvelopeRecord?.id===targetId)||
       (kind==='installation'&&activeInstallationSection?.id===targetId)))
     renderSectionPhotos(host,photos,kind,targetId,page,dossierId);
  }catch(error){err(error)}finally{endEpcLoading()}
 })();
 epcPhotoLoads.set(cacheKey,task);
 try{await task}finally{epcPhotoLoads.delete(cacheKey)}
}
function renderSectionPhotos(host,photos,kind,targetId,page,dossierId){
 const fragment=document.createDocumentFragment();
 for(const photo of photos){
  if(!photo.url)continue;
  const tile=document.createElement('div');tile.className='epc-photo-tile';
  const open=document.createElement('button');open.type='button';open.className='epc-photo-open';
  const img=document.createElement('img');img.src=photo.url;img.alt=photo.filename;
  img.loading='eager';img.decoding='async';
  const overlayStamp=document.createElement('span');
  overlayStamp.className='epc-photo-stamp';
  overlayStamp.textContent=formatPhotoTimestamp(photo.created_at);
  open.append(img,overlayStamp);
  open.onclick=()=>openPhoto(photo.filename,photo.url,photo.created_at);
  const del=document.createElement('button');del.type='button';del.className='epc-photo-delete';
  del.title='Foto verwijderen';del.setAttribute('aria-label','Foto '+photo.filename+' verwijderen');
  const delIcon=document.createElement('img');delIcon.src='ico/delete.svg';delIcon.alt='';del.append(delIcon);
  del.onclick=async()=>{
   if(!confirm('Foto '+photo.filename+' verwijderen?'))return;
   beginEpcLoading('Foto verwijderen…');
   try{
    const {error}=await db.from('epc_section_photos')
     .update({deleted_at:new Date().toISOString()}).eq('id',photo.id).eq('dossier_id',dossierId);
    if(error)throw error;
    epcPhotoCache.delete(`${dossierId}:${kind}:${targetId}`);
    await loadSectionPhotos(kind,targetId,page,{force:true});note('Foto verwijderd.');
   }catch(error){err(error)}finally{endEpcLoading()}
  };
  const caption=document.createElement('span');caption.className='epc-photo-caption';caption.textContent=photo.filename;
  tile.append(open,del,caption);fragment.append(tile);
 }
 host.replaceChildren(fragment);
}
function openPhoto(name,url,timestamp){
 $('epc-photo-viewer-image').src=url;$('epc-photo-viewer-name').textContent=name+' · '+formatPhotoTimestamp(timestamp);
 show('epc-photo-viewer');document.body.classList.add('epc-viewing-photo');
}
function closePhoto(){show('epc-photo-viewer',false);$('epc-photo-viewer-image').removeAttribute('src');document.body.classList.remove('epc-viewing-photo')}
$('epc-photo-viewer-close').onclick=closePhoto;
$('epc-photo-viewer').onclick=e=>{if(e.target.id==='epc-photo-viewer')closePhoto()};
document.addEventListener('keydown',e=>{if(e.key==='Escape')closePhoto()});
photoInput.onchange=async()=>{
 const file=photoInput.files?.[0],target=photoTargets[photoInput.dataset.target]?.();
 if(!file||!target||photoUploadBusy||!activeDossier||!workspace)return;
 if(!file.type.startsWith('image/'))return note('Selecteer een foto.');
 if(file.size>20*1024*1024)return note('Foto mag maximaal 20 MB zijn.');
 photoUploadBusy=true;beginEpcLoading('Foto opslaan…');
 try{
  const dossierId=activeDossier.id;
  const {data:existing,error:listError}=await db.from('epc_section_photos').select('filename')
   .eq('dossier_id',dossierId).eq('section_kind',target.kind).eq('section_id',target.id);
  if(listError)throw listError;
  const prefix=photoBase(target.name)+'_';
  const used=(existing||[]).map(p=>Number(p.filename.slice(prefix.length).match(/^(\d+)/)?.[1]||0));
  const sequence=String(Math.max(0,...used)+1).padStart(3,'0');
  // Storage accepts JPG/PNG/WebP; keep the original supported type.
  const ext=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';
  const filename=prefix+sequence+'.'+ext;
  const path=workspace+'/'+dossierId+'/'+filename;
  const {error:uploadError}=await db.storage.from(PHOTO_BUCKET).upload(path,file,{contentType:file.type,upsert:false});
  if(uploadError)throw uploadError;
  const {error:metaError}=await db.from('epc_section_photos').insert({
   dossier_id:dossierId,section_kind:target.kind,section_id:target.id,filename,storage_path:path,content_type:file.type,size_bytes:file.size
  });
  if(metaError)throw metaError;
  epcPhotoCache.delete(`${dossierId}:${target.kind}:${target.id}`);
  await loadSectionPhotos(target.kind,target.id,target.page,{force:true});note('Foto opgeslagen: '+filename);
 }catch(e){err(e)}finally{photoUploadBusy=false;photoInput.value='';endEpcLoading()}
};

function refreshScrollTop(){show('scroll-top',scrollPosition()>170)}
$('scroll-top').onclick=()=>{
 window.scrollTo({top:0,behavior:'smooth'});
 for(const el of document.querySelectorAll('main, main section:not(.hidden)'))if(el.scrollTop>0)el.scrollTo({top:0,behavior:'smooth'});
};
document.addEventListener('scroll',refreshScrollTop,{passive:true,capture:true});
window.addEventListener('scroll',refreshScrollTop,{passive:true});

function toggle(){show('vat-row',$('client-kind').value==='onderneming');show('client-address',!$('same').checked)}$('client-kind').onchange=toggle;$('same').onchange=toggle;
function address(prefix){return Object.fromEntries(['street','number','postal','city'].map(k=>[k,field(prefix+'_'+k).value.trim()]))}
function validVat(s){if(!s)return false;const v=s.toUpperCase().replace(/[.\s-]/g,'');if(!/^BE\d{10}$/.test(v))return false;const digits=v.slice(2),base=Number(digits.slice(0,8)),check=Number(digits.slice(8));return 97-(base%97)===check}
f.onsubmit=async e=>{e.preventDefault();if(!workspace)return note('Geen werkruimte beschikbaar.');const kind=field('client_kind').value,vat=field('client_vat_number').value.trim();if(kind==='onderneming'&&vat&&!validVat(vat))return note('Ongeldig Belgisch btw-nummer (controlecijfers).');const property=address('property'),same=$('same').checked;const payload={dossier_type:field('dossier_type').value,client_phone:field('client_phone').value.trim()||null,client_email:field('client_email').value.trim()||null,dossier_number:field('dossier_number').value.trim()||null,inspection_date:field('inspection_date').value||null,client_kind:kind,client_name:field('client_name').value.trim(),client_vat_number:kind==='onderneming'?(vat||null):null,client_address_same_as_property:same,client_address:same?property:address('client'),property_address:property,title:`${property.street} ${property.number}, ${property.city}`.trim()};$('save').disabled=true;try{let r;if(current){r=await db.from('epc_dossiers').update(payload).eq('id',current).eq('workspace_id',workspace).select('id').single()}else{r=await db.from('epc_dossiers').insert({...payload,workspace_id:workspace,created_by:user.id}).select('id').single()}if(r.error)throw r.error;current=r.data.id;screen('home');await load();note('Dossier opgeslagen in Supabase.')}catch(ex){err(ex)}finally{$('save').disabled=false}};

// --- EPC Buddy guided construction input -------------------------------------
// All choices use the EXISTING form controls and validation. Only the new
// 'finish' attribute requires a nullable database column (SQL patch included).
// The wizard never writes to Supabase until the user explicitly taps Opslaan.
const WIZ_FINISH={
 facade:['Gevelsteen','Hout','Crepi','Natuursteen','Sidings','Leien','Vulpaneel','Zink','PVC','Glas','Andere'],
 hellend_dak:['Pannen','Leien','Riet','Zink','Hout','Golfplaten','Andere','Glas'],
 plat_dak:['Roofing','EPDM','Rubber','Zink','Hout','Golfplaten','PVC','Andere','Glas']
};
const WIZ_LABELS={boundary:'Begrenzing',finish:'Afwerking',fully_glazed:'Volledig beglaasd',
 dormer_count:'Aantal dakkapellen',slope:'Helling',insulation:'Isolatie',
 insulation_thickness_mm:'Dikte isolatie',insulation_location:'Plaats isolatie',
 insulation_interruption:'Onderbreking isolatie',air_layer:'Luchtlaag',
 wall_type:'Muurtype',element_type:'Constructietype',floor_heating:'Vloerverwarming',
 renovation_reference_year:'Referentiejaar renovatie',remarks:'Opmerking',name:'Naam'};
let wizard=null;
function wizardInput(form,key){return [...form.elements].find(el=>el.name===key&&!el.disabled)}
function wizardValue(form,key){return wizardInput(form,key)?.value||''}
function wizardSteps(kind){
 const base=kind==='facade'?
 ['boundary','finish','fully_glazed','insulation','insulation_thickness_mm','insulation_location','insulation_interruption','air_layer','wall_type','final_details']:
 kind==='hellend_dak'?['fully_glazed','finish','dormer_count','slope','insulation','insulation_thickness_mm','insulation_interruption','air_layer','element_type','final_details']:
 kind==='plat_dak'?['fully_glazed','finish','insulation','insulation_thickness_mm','insulation_interruption','air_layer','element_type','final_details']:
 kind==='plafond'?['boundary','insulation','insulation_thickness_mm','insulation_interruption','air_layer','element_type','final_details']:
 ['boundary','insulation','insulation_thickness_mm','insulation_interruption','floor_heating','air_layer','element_type','final_details'];
 return base.filter(k=>k==='final_details'||wizardInput(wizard.form,k));
}
function wizardVisibleSteps(){
 return wizard.steps.filter(k=>!(wizardValue(wizard.form,'insulation')==='Afwezig'||wizardValue(wizard.form,'insulation')==='Geen')||!['insulation_thickness_mm','insulation_location','insulation_interruption'].includes(k));
}
function wizardSuggestedName(){
 const f=wizard.form,k=wizard.kind;
 const fin=wizardValue(f,'finish');const bound=wizardValue(f,'boundary');
 if(k==='facade')return ['Muur',fin,bound].filter(Boolean).join(' ');
 if(k==='hellend_dak')return ['Hellend dak',fin].filter(Boolean).join(' ');
 if(k==='plat_dak')return ['Plat dak',fin].filter(Boolean).join(' ');
 if(k==='plafond')return ['Plafond',bound].filter(Boolean).join(' ');
 return ['Vloer',bound].filter(Boolean).join(' ');
}
function wizardStart(form,kind){
 const host=$(form.id.replace('-form','-wizard'));
 wizard={form,kind,host,steps:[],index:0,otherValues:{},otherSelections:{}};
 wizard.steps=wizardSteps(kind);
 // For new records, replace the old long form with a single-step tile interface.
 form.classList.add('epc-form-wizard-hidden');host.classList.remove('hidden');
 wizardRender();
}
function wizardSubmitWithoutFlash(form){
 // Keep the wizard visible while the async save is in progress.
 // Stopping it first briefly exposes the legacy long form.
 if(wizard?.form===form){
  wizard.host.replaceChildren();
  const waiting=document.createElement('div');waiting.className='epc-wizard-saving';waiting.textContent='Opslaan…';
  wizard.host.append(waiting);
 }
 form.requestSubmit();
}
function wizardStop(form){
 if(wizard?.form===form)wizard=null;
 form.classList.remove('epc-form-wizard-hidden');
 $(form.id.replace('-form','-wizard')).classList.add('hidden');
}
function wizardSet(key,value){
 const el=wizardInput(wizard.form,key);if(!el)return;
 // Custom "Andere" text is saved in the underlying field where possible.
 // Unknown select options are inserted explicitly, not silently discarded.
 if(el.tagName==='SELECT'&&![...el.options].some(o=>o.value===value)){
  const o=document.createElement('option');o.value=value;o.textContent=value;el.append(o);
 }
 el.value=value;
 if(key==='insulation'&&(value==='Afwezig'||value==='Geen')){
  for(const dep of ['insulation_thickness_mm','insulation_location','insulation_interruption']){
   const input=wizardInput(wizard.form,dep);if(input)input.value='';
  }
 }
}
function wizardAdvance(){
 const visible=wizardVisibleSteps();const current=wizard.steps[wizard.index];
 const i=visible.indexOf(current);
 wizard.index=wizard.steps.indexOf(visible[Math.min(i+1,visible.length-1)]);
 wizardRender();
}
function wizardBack(){
 const visible=wizardVisibleSteps();const current=wizard.steps[wizard.index];
 const i=visible.indexOf(current);
 if(i>0){wizard.index=wizard.steps.indexOf(visible[i-1]);wizardRender()}
 else wizardStop(wizard.form);
}
function wizardRender(){
 if(!wizard)return;
 const {host,form,kind}=wizard;host.replaceChildren();
 const visible=wizardVisibleSteps();
 if(!visible.includes(wizard.steps[wizard.index]))wizard.index=wizard.steps.indexOf(visible[0]);
 const key=wizard.steps[wizard.index],el=key==='final_details'?null:wizardInput(form,key);
 const step=document.createElement('div');step.className='epc-wizard-step';
 const progress=document.createElement('div');progress.className='epc-wizard-progress';
 progress.textContent=`${visible.indexOf(key)+1} / ${visible.length}`;
 const title=document.createElement('h2');title.textContent=key==='final_details'?'Andere':(WIZ_LABELS[key]||key);
 const top=document.createElement('div');top.className='epc-wizard-top';
 const back=document.createElement('button');back.type='button';back.className='epc-wizard-back';
 // Reuse the exact previous-arrow SVG and button size used elsewhere in EPC Buddy.
 const backIcon=document.createElement('img');backIcon.src='ico/vorige-pijl.svg';backIcon.alt='';
 back.append(backIcon);back.setAttribute('aria-label','Vorige stap');back.onclick=wizardBack;
 top.append(back,title,progress);step.append(top);
 const options=key==='finish'?WIZ_FINISH[kind]:
 key==='dormer_count'?['Geen','1','2','3','4','5']:
 el?.tagName==='SELECT'?[...el.options].filter(o=>o.value!==''&&!o.disabled).map(o=>({value:o.value,label:o.textContent.trim()})):null;
 if(options){
  const grid=document.createElement('div');grid.className='epc-wizard-grid';
  for(const item of options){
   const value=typeof item==='string'?item:item.value;
   const label=typeof item==='string'?item:item.label;
   const button=document.createElement('button');button.type='button';button.className='epc-wizard-choice';
   if((wizard.otherSelections[key]===value)||(wizardValue(form,key)===value))button.classList.add('selected');
   button.textContent=label;
   button.onclick=()=>{
    // 'Ja, andere' is a complete protocol option for the air layer:
    // no additional free-text details should be requested.
    if(key==='air_layer'&&value.toLocaleLowerCase('nl-BE')==='ja, andere'){
     delete wizard.otherSelections[key];
     wizardSet(key,value);
     wizardAdvance();
     return;
    }
    if(value==='Andere'||value==='Ja, andere'){
     wizard.otherSelections[key]=value;wizardRender();return;
    }
    delete wizard.otherSelections[key];
    wizardSet(key,key==='dormer_count'&&value==='Geen'?'0':value);wizardAdvance();
   };
   grid.append(button);
  }
  // Keep the 'Andere' tile selected and its text visible when navigating back.
  step.append(grid);
  if(wizard.otherSelections[key]&&!(key==='air_layer'&&wizard.otherSelections[key].toLocaleLowerCase('nl-BE')==='ja, andere'))wizardOther(key,wizard.otherSelections[key],step);
 }else if(key==='final_details'){
  wizardFinalDetails(step,form);
 }else{
  const area=key==='remarks';
  const input=document.createElement(area?'textarea':'input');
  if(!area){input.type=el?.type==='number'?'number':'text';if(input.type==='number')input.min='0'}
  input.className='epc-wizard-input';input.value=key==='name'?(wizard.otherValues.manualName||wizardSuggestedName()):wizardValue(form,key);
  input.placeholder=key==='name'?'Naam van de constructie':WIZ_LABELS[key];
  if(area)input.rows=4;
  if(key==='insulation_thickness_mm'){
   // 'Onbekend' is a deliberate empty thickness, not an invented measurement.
   const unknown=document.createElement('button');unknown.type='button';
   unknown.className='epc-wizard-unknown'+(wizard.otherValues.thicknessUnknown?' selected':'');
   unknown.textContent='ONBEKEND';
   unknown.onclick=()=>{wizard.otherValues.thicknessUnknown=true;wizardSet(key,'');wizardAdvance()};
   step.append(unknown);
   input.addEventListener('input',()=>{wizard.otherValues.thicknessUnknown=false;unknown.classList.remove('selected')});
   // Unit appears next to the field, not inside its numeric value.
   const row=document.createElement('div');row.className='epc-wizard-measure';
   const unit=document.createElement('span');unit.textContent='MM';row.append(input,unit);step.append(row);
  }else step.append(input);
  if(key==='dormer_count')input.inputMode='numeric';
  const next=document.createElement('button');next.type='button';next.className='epc-wizard-next';
  next.textContent=key==='name'?'Opslaan':'Volgende';
  next.onclick=()=>{
   if(key==='name'&&!input.value.trim()){input.focus();return}
   wizardSet(key,input.value.trim());
   if(key==='name'){
    const activeForm=form;wizardSubmitWithoutFlash(activeForm);
   }else wizardAdvance();
  };
  step.append(next);
  if(key==='name')input.addEventListener('input',()=>{wizard.otherValues.manualName=input.value});
 }
 host.append(step);
}
// Names identify shared construction definitions within a dossier. Validate before
// leaving the wizard so a duplicate never silently creates another definition.
// This is a UX validation, not a database uniqueness guarantee: concurrent saves
// must ultimately be protected by a unique database constraint/RPC.
async function wizardNameAlreadyExists(name){
 if(!activeDossier)throw new Error('Geen actief dossier.');
 const table=wizard.kind==='facade'?'epc_facade_constructions':'epc_envelope_constructions';
 let query=db.from(table).select('id,name').eq('dossier_id',activeDossier.id).is('deleted_at',null);
 if(wizard.kind!=='facade')query=query.eq('element_kind',wizard.kind);
 const {data,error}=await query;
 if(error)throw error;
 const normalize=value=>String(value||'').trim().normalize('NFKC').toLocaleLowerCase('nl-BE');
 const proposed=normalize(name);
 return (data||[]).some(item=>normalize(item.name)===proposed);
}
// Last wizard page: renovation year and remarks together, plus an editable
// automatically suggested construction name. Nothing is persisted until Opslaan.
function wizardFinalDetails(step,form){
 const group=document.createElement('div');group.className='epc-wizard-final';
 const fields=[
  {key:'renovation_reference_year',label:'REFERENTIEJAAR RENOVATIE',type:'number'},
  {key:'remarks',label:'OPMERKING',type:'textarea'},
  {key:'name',label:'NAAM CONSTRUCTIE',type:'text'}
 ];
 const controls={};
 for(const item of fields){
  const label=document.createElement('label');label.textContent=item.label;
  const input=document.createElement(item.type==='textarea'?'textarea':'input');
  if(item.type!=='textarea')input.type=item.type;
  if(item.type==='number'){input.min='0';input.max='9999';input.inputMode='numeric'}
  input.className='epc-wizard-final-input';
  input.value=item.key==='name'?(wizard.otherValues.manualName||wizardSuggestedName()):wizardValue(form,item.key);
  if(item.key==='name')input.addEventListener('input',()=>{wizard.otherValues.manualName=input.value;input.removeAttribute('aria-invalid');group.querySelector('.epc-wizard-name-error')?.remove()});
  label.append(input);group.append(label);controls[item.key]=input;
 }
 const actions=document.createElement('div');actions.className='epc-wizard-final-actions';
 const cancel=document.createElement('button');cancel.type='button';cancel.className='epc-wizard-cancel';cancel.textContent='Annuleren';cancel.onclick=()=>wizardStop(form);
 const save=document.createElement('button');save.type='button';save.className='epc-wizard-next';save.textContent='Opslaan';
 save.onclick=async()=>{
  const proposedName=controls.name.value.trim();
  if(!proposedName){controls.name.focus();return}
  // Keep the name field visible when an existing definition has the same name.
  // Do not stop the wizard or submit the underlying form in that case.
  save.disabled=true;
  const previousError=group.querySelector('.epc-wizard-name-error');
  if(previousError)previousError.remove();
  controls.name.removeAttribute('aria-invalid');
  try{
   if(await wizardNameAlreadyExists(proposedName)){
    const warning=document.createElement('p');
    warning.className='epc-wizard-name-error';warning.setAttribute('role','alert');
    warning.textContent='Er bestaat al een constructie met deze naam in dit dossier. Pas de naam aan.';
    controls.name.parentElement.after(warning);
    controls.name.setAttribute('aria-invalid','true');
    controls.name.focus();
    return;
   }
  }catch(error){err(error);return}
  finally{save.disabled=false}
  for(const item of fields)wizardSet(item.key,controls[item.key].value.trim());
  const extras=Object.entries(wizard.otherSelections)
   .filter(([key])=>key!=='finish'&&wizard.otherValues[key]?.trim())
   .map(([key])=>`${WIZ_LABELS[key]||key} – Andere: ${wizard.otherValues[key].trim()}`);
  if(extras.length){
   const remarks=wizardInput(form,'remarks');
   if(remarks)remarks.value=[remarks.value,...extras].filter(Boolean).join('\n');
  }
  wizardSubmitWithoutFlash(form);
 };
 actions.append(cancel,save);group.append(actions);step.append(group);
}
function wizardOther(key,value,step){
 // The free-text input belongs immediately below the choice tiles. It must
 // survive navigation, and its corresponding 'Andere' tile stays selected.
 const old=step.querySelector('.epc-wizard-other');if(old)old.remove();
 const box=document.createElement('div');box.className='epc-wizard-other';
 const input=document.createElement('input');input.type='text';input.maxLength=120;
 input.className='epc-wizard-input';
 input.placeholder='Geef de andere uitvoering op';input.setAttribute('aria-label','Andere uitvoering');
 input.value=wizard.otherValues[key]||'';
 input.addEventListener('input',()=>{wizard.otherValues[key]=input.value});
 const next=document.createElement('button');next.type='button';next.className='epc-wizard-next';next.textContent='Volgende';
 next.onclick=()=>{
  const detail=input.value.trim();if(!detail){input.focus();return}
  wizard.otherValues[key]=detail;
  // Finishes have their own text column; other fixed protocol selections
  // keep the canonical option and add the detail to remarks on save.
  wizardSet(key,key==='finish'?detail:value);
  wizardAdvance();
 };
 box.append(input,next);
 const grid=step.querySelector('.epc-wizard-grid');
 if(grid)grid.after(box);else step.append(box);
}



// Ventilatieruimte en Ventilatie-unit volgens het aangeleverde schema.
const VENT_WET_ROOMS=['Keuken','Wasplaats','Badkamer','Wc','Douchekamer'];
const VENT_ROOMS=[...VENT_WET_ROOMS,'Woonkamer','Slaapkamer','Bureau','Hobbyruimte','Andere'];
const VENT_WET=['Geen afvoer','Natuurlijk, verticaal','Natuurlijk, horizontaal','Mechanisch, permanent','Mechanisch, niet permanent'];
const VENT_DRY=['Geen toevoer','Natuurlijk','Mechanisch, permanent','Mechanisch, niet permanent'];
const VENT_CONTROLS=['Niet aanwezig','Onbekend','Manueel','Klokregeling','Vraagsturing, centraal','Vraagsturing, plaatselijk'];
let ventilationWizard=null;
async function fetchVentRooms(){
 const {data:sections,error}=await db.from('epc_installation_sections').select('id').eq('dossier_id',activeDossier.id).eq('kind','room_ventilation').is('deleted_at',null);
 if(error){err(error);return []}if(!sections?.length)return [];
 const {data,error:e}=await db.from('epc_installation_entries').select('id,name,details').eq('dossier_id',activeDossier.id).in('section_id',sections.map(x=>x.id)).is('deleted_at',null);
 if(e){err(e);return []}return (data||[]).filter(room=>room.details?.type==='Mechanisch, permanent');
}
function ventilationSteps(w){const v=w.values;
 if(w.kind==='room_ventilation'){
  const steps=[{key:'room',title:'Ruimte',choices:VENT_ROOMS}];
  if(!v.room)return steps;
  if(v.room==='Andere')steps.push({key:'custom_room',title:'Naam andere ruimte',input:true});
  if(v.room==='Andere')steps.push({key:'room_type',title:'Ruimtetype',choices:['Natte ruimte','Droge ruimte']});
  const wet=v.room_type==='Natte ruimte'||VENT_WET_ROOMS.includes(v.room);
  if(v.room!=='Andere'||v.room_type)steps.push({key:'type',title:wet?'Afvoer':'Toevoer',choices:wet?VENT_WET:VENT_DRY});
  steps.push({key:'name',title:'Naamgeving',input:true});return steps;
 }
 return [{key:'device',title:'Toestelgegevens',device:true},{key:'scope',title:'Individueel of collectief',choices:['Individueel','Collectief']},
 {key:'type',title:'Type ventilatie',choices:['Toevoer en afvoer','Enkel toevoer','Enkel afvoer']},
 {key:'control',title:'Regeling',choices:VENT_CONTROLS},{key:'served_rooms',title:'Bediende ventilatieruimtes',rooms:true},
 {key:'name',title:'Naamgeving',input:true}];
}
async function startVentilationWizard(){
 const kind=activeInstallationSection.kind;
 const {data,error}=await db.from('epc_installation_entries').select('name').eq('dossier_id',activeDossier.id).eq('section_id',activeInstallationSection.id).is('deleted_at',null);
 if(error)return err(error);
 const rooms=kind==='ventilation_unit'?await fetchVentRooms():[];
 if(kind==='ventilation_unit'&&!rooms.length){note('Voeg eerst minstens één ventilatieruimte met Mechanisch, permanent toe.');return}
 ventilationWizard={kind,step:0,values:{},names:(data||[]).map(x=>x.name),rooms};activeInstallation=null;
 $('installation-edit-title').textContent='Nieuwe '+activeInstallationSection.name.toLocaleLowerCase('nl-BE');$('installation-edit-icon').replaceChildren(iconFor(activeInstallationSection.name));
 show('installation-form',false);show('installation-wizard',true);screen('installation-editor');renderVentilationWizard();
}
function renderVentilationWizard(){
 const w=ventilationWizard;if(!w)return;const steps=ventilationSteps(w);w.step=Math.min(w.step,steps.length-1);const step=steps[w.step];
 const host=$('installation-wizard');host.replaceChildren();const root=document.createElement('div');root.className='epc-wizard-step epc-heating-wizard';
 const top=document.createElement('div');top.className='epc-wizard-top';if(w.step){const back=document.createElement('button');back.type='button';back.className='epc-wizard-back';const img=document.createElement('img');img.src='ico/vorige-pijl.svg';img.alt='Vorige';back.append(img);back.onclick=()=>{w.step--;renderVentilationWizard()};top.append(back)}
 const title=document.createElement('strong');title.textContent=step.title;top.append(title);const progress=document.createElement('span');progress.className='epc-wizard-progress';progress.textContent=(w.step+1)+' / '+steps.length;top.append(progress);root.append(top);
 const next=()=>{w.step++;renderVentilationWizard()};
 const button=(text,fn)=>{const b=document.createElement('button');b.type='button';b.className='epc-wizard-next';b.textContent=text;b.onclick=fn;root.append(b)};
 if(step.choices){const grid=document.createElement('div');grid.className='epc-wizard-grid';for(const choice of step.choices){const b=document.createElement('button');b.type='button';b.className='epc-wizard-choice'+(w.values[step.key]===choice?' selected':'');b.textContent=choice;b.onclick=()=>{if(step.key==='room'){w.values.room_type=VENT_WET_ROOMS.includes(choice)?'Natte ruimte':choice==='Andere'?'':'Droge ruimte';delete w.values.type;delete w.values.custom_room}if(step.key==='room_type')delete w.values.type;w.values[step.key]=choice;next()};grid.append(b)}root.append(grid)}
 else if(step.rooms){const grid=document.createElement('div');grid.className='epc-wizard-grid';const selected=new Set(w.values.served_rooms||[]);for(const room of w.rooms){const b=document.createElement('button');b.type='button';b.className='epc-wizard-choice'+(selected.has(room.id)?' selected':'');b.textContent=room.name;b.onclick=()=>{selected.has(room.id)?selected.delete(room.id):selected.add(room.id);w.values.served_rooms=[...selected];b.classList.toggle('selected',selected.has(room.id))};grid.append(b)}root.append(grid);if(!w.rooms.length){const p=document.createElement('p');p.textContent='Geen ventilatieruimtes met Mechanisch, permanent beschikbaar.';root.append(p)}else{button('Alle ruimtes toevoegen',()=>{w.values.served_rooms=w.rooms.map(room=>room.id);next()})}button('Volgende',next)}
 else if(step.device){const fields=document.createElement('div');fields.className='epc-heating-fields';for(const [key,label] of [['brand','Merk'],['model','Type / model'],['remarks','Opmerking']]){const wrap=document.createElement('label');wrap.className='epc-heating-field';wrap.textContent=label;const input=document.createElement(key==='remarks'?'textarea':'input');input.className='epc-wizard-input';input.value=w.values[key]||'';input.oninput=()=>{w.values[key]=input.value};wrap.append(input);fields.append(wrap)}root.append(fields);button('Volgende',next)}
 else{const input=document.createElement(step.key==='remarks'?'textarea':'input');input.className='epc-wizard-input';input.value=w.values[step.key]??(step.key==='name'?(w.kind==='room_ventilation'?'VR-':'VU-')+(w.kind==='room_ventilation'?(w.values.custom_room||w.values.room||''): [w.values.brand,w.values.model].filter(Boolean).join('-')):'');input.placeholder=step.title;input.oninput=()=>{w.values[step.key]=input.value};root.append(input);button(step.key==='name'?'Opslaan':'Volgende',()=>{const value=input.value.trim();if(step.key!=='remarks'&&!value){note('Vul '+step.title.toLocaleLowerCase('nl-BE')+' in.');input.focus();return}w.values[step.key]=value;step.key==='name'?saveVentilationWizard():next()})}
 host.append(root);
}
async function saveVentilationWizard(){
 const w=ventilationWizard;if(!w)return;const name=String(w.values.name||'').trim();if(!name){note('Vul een naam in.');return}
 if(w.names.some(x=>x.toLocaleLowerCase('nl-BE')===name.toLocaleLowerCase('nl-BE'))){note('Deze naam bestaat al. Kies een andere naam.');return}
 const {name:ignored,remarks,...details}=w.values;
 const {error}=await db.from('epc_installation_entries').insert({dossier_id:activeDossier.id,section_id:activeInstallationSection.id,name,remarks:w.kind==='room_ventilation'?null:(remarks||null),details});if(error)return err(error);
 ventilationWizard=null;show('installation-wizard',false);show('installation-form',true);screen('installation-page');await loadInstallationEntries();await loadSectionPhotos('installation',activeInstallationSection.id,'installation-page');note('Ventilatie opgeslagen.');
}
// Koeling: dossierafhankelijke aanmaakwizard (kNR / RES / GD).
const COOL_TYPES=['Geen','Onbekend','Onvolledig','Aanwezig'];
const COOL_GENERATORS=['Lucht/lucht','Water/lucht','Bodem/lucht','Lucht/water','Water/water','Bodem/water'];
const COOL_ROOMS=['LEEFRUIMTE','KEUKEN','BADKAMER','WASPLAATS',...Array.from({length:10},(_,i)=>'SLP'+(i+1))];
let coolingWizard=null;
function coolingSteps(){
 const t=coolingWizard.type,v=coolingWizard.values;
 if(t==='kNR')return [{key:'cooling',title:'Type actieve koeling',choices:COOL_TYPES},{key:'generator',title:'Type opwekker',choices:COOL_GENERATORS},{key:'refrigerant',title:'Type koelmiddel',choices:['Onbekend','Gekend']},...(v.refrigerant==='Gekend'?[{key:'refrigerant_type',title:'Koelmiddel',input:true}]:[]),{key:'device',title:'Toestelgegevens'},{key:'name',title:'Naamgeving'}];
 if(t==='RES')return [{key:'rooms',title:'Direct gekoelde ruimtes'},{key:'device',title:'Toestelgegevens'},{key:'name',title:'Naamgeving'}];
 return [{key:'device',title:'Toestelgegevens'},{key:'name',title:'Naamgeving'}];
}
function buildCoolingRoomPicker(initial,onDone){
 const root=document.createElement('div');root.className='epc-cooling-rooms';const selected=new Set(initial);
 const choices=document.createElement('div');choices.className='epc-wizard-grid';
 const custom=document.createElement('div');custom.className='epc-cooling-custom';
 const draw=()=>{choices.replaceChildren();const all=[...COOL_ROOMS,...[...selected].filter(x=>!COOL_ROOMS.includes(x))];for(const room of all){const b=document.createElement('button');b.type='button';b.className='epc-wizard-choice'+(selected.has(room)?' selected':'');b.textContent=room;b.onclick=()=>{selected.has(room)?selected.delete(room):selected.add(room);draw()};choices.append(b)}};
 draw();root.append(choices);
 const row=document.createElement('div');row.className='epc-cooling-add-room';const input=document.createElement('input');input.className='epc-wizard-input';input.placeholder='Andere ruimte toevoegen';input.setAttribute('aria-label','Andere ruimte');const add=document.createElement('button');add.type='button';add.className='epc-wizard-next';add.textContent='Toevoegen';add.onclick=()=>{const val=input.value.trim().toLocaleUpperCase('nl-BE');if(val){selected.add(val);input.value='';draw()}};row.append(input,add);root.append(row);
 const done=document.createElement('button');done.type='button';done.className='epc-wizard-next';done.textContent='Bevestigen';done.onclick=()=>onDone([...selected]);root.append(done);return root;
}
async function startCoolingWizard(){
 const {data,error}=await db.from('epc_installation_entries').select('name').eq('section_id',activeInstallationSection.id).eq('dossier_id',activeDossier.id).is('deleted_at',null);if(error)return err(error);
 coolingWizard={type:dossierType(activeDossier),values:{},step:0,names:(data||[]).map(x=>x.name)};activeInstallation=null;
 $('installation-edit-title').textContent='Nieuwe '+activeInstallationSection.name.toLocaleLowerCase('nl-BE');$('installation-edit-icon').replaceChildren(iconFor(activeInstallationSection.name));show('installation-form',false);show('installation-wizard',true);screen('installation-editor');renderCoolingWizard();
}
function renderCoolingWizard(){
 const w=coolingWizard;if(!w)return;const steps=coolingSteps();w.step=Math.min(w.step,steps.length-1);const step=steps[w.step],host=$('installation-wizard');host.replaceChildren();const root=document.createElement('div');root.className='epc-wizard-step epc-heating-wizard';
 const top=document.createElement('div');top.className='epc-wizard-top';if(w.step){const back=document.createElement('button');back.type='button';back.className='epc-wizard-back';const img=document.createElement('img');img.src='ico/vorige-pijl.svg';img.alt='Vorige';back.append(img);back.onclick=()=>{w.step--;renderCoolingWizard()};top.append(back)}const title=document.createElement('strong');title.textContent=step.title;top.append(title);const progress=document.createElement('span');progress.className='epc-wizard-progress';progress.textContent=(w.step+1)+' / '+steps.length;top.append(progress);root.append(top);
 const next=()=>{w.step++;renderCoolingWizard()};
 if(step.choices){const grid=document.createElement('div');grid.className='epc-wizard-grid';for(const choice of step.choices){const b=document.createElement('button');b.type='button';b.className='epc-wizard-choice'+(w.values[step.key]===choice?' selected':'');b.textContent=choice;b.onclick=()=>{w.values[step.key]=choice;if(step.key==='refrigerant'&&choice!=='Gekend')delete w.values.refrigerant_type;next()};grid.append(b)}root.append(grid)}
 else if(step.key==='rooms')root.append(buildCoolingRoomPicker(w.values.rooms||[],rooms=>{w.values.rooms=rooms;next()}));
 else if(step.key==='device'){const fields=document.createElement('div');fields.className='epc-heating-fields';const defs=[['brand','Merk','input'],['model','Type / model','input'],...(w.type==='kNR'?[['year','Referentiejaar fabricage','input']]:[]),['remarks','Opmerking','textarea']];for(const [key,label,tag] of defs){const wrap=document.createElement('label');wrap.className='epc-heating-field';wrap.textContent=label;const el=document.createElement(tag);el.className='epc-wizard-input';el.value=w.values[key]||'';if(key==='year'){el.type='number';el.min='1800';el.max='2100'}el.oninput=()=>{w.values[key]=el.value};wrap.append(el);fields.append(wrap)}root.append(fields);const b=document.createElement('button');b.type='button';b.className='epc-wizard-next';b.textContent='Volgende';b.onclick=next;root.append(b)}
 else{const input=document.createElement('input');input.className='epc-wizard-input';input.value=w.values[step.key]??(step.key==='name'?['Koeling',w.values.brand,w.values.model].filter(Boolean).join('-'):'');input.placeholder=step.title;input.oninput=()=>{w.values[step.key]=input.value};root.append(input);const b=document.createElement('button');b.type='button';b.className='epc-wizard-next';b.textContent=step.key==='name'?'Opslaan':'Volgende';b.onclick=()=>{const value=input.value.trim();if(!value){note('Vul '+step.title.toLocaleLowerCase('nl-BE')+' in.');input.focus();return}w.values[step.key]=value;if(step.key==='name')saveCoolingWizard();else next()};root.append(b)}host.append(root);
}
async function saveCoolingWizard(){
 const w=coolingWizard;if(!w)return;const name=String(w.values.name||'').trim();if(!name){note('Vul een naam in.');return}if(w.names.some(x=>x.toLocaleLowerCase('nl-BE')===name.toLocaleLowerCase('nl-BE'))){note('Deze naam bestaat al. Kies een andere naam.');return}
 const {name:unused,remarks,...details}=w.values;const {error}=await db.from('epc_installation_entries').insert({dossier_id:activeDossier.id,section_id:activeInstallationSection.id,name,remarks:remarks||null,details});if(error)return err(error);coolingWizard=null;show('installation-wizard',false);show('installation-form',true);screen('installation-page');await loadInstallationEntries();await loadSectionPhotos('installation',activeInstallationSection.id,'installation-page');note('Koeling opgeslagen.');
}
// Herbruikbare wizards voor zonneboiler, PV-panelen en verlichting.
let simpleInstallationWizard=null;
async function fetchSolarRoofs(){
 const {data,error}=await db.from('epc_envelope_elements').select('name').eq('dossier_id',activeDossier.id).is('deleted_at',null);
 if(error){err(error);return ['Dak buiten beschermd volume']}
 return [...new Set([...(data||[]).filter(x=>/^Hellend dak|^Plat dak/i.test(x.name)).map(x=>x.name),'Dak buiten beschermd volume'])];
}
async function startSimpleInstallationWizard(){
 const kind=activeInstallationSection.kind;
 const {data,error}=await db.from('epc_installation_entries').select('name').eq('dossier_id',activeDossier.id).eq('section_id',activeInstallationSection.id).is('deleted_at',null);
 if(error)return err(error);
 simpleInstallationWizard={kind,step:0,values:{},existing:(data||[]).map(x=>x.name),roofs:['solar_thermal','pv'].includes(kind)?await fetchSolarRoofs():[]};
 activeInstallation=null;$('installation-edit-title').textContent='Nieuwe '+activeInstallationSection.name;
 $('installation-edit-icon').replaceChildren(iconFor(activeInstallationSection.name));
 show('installation-form',false);show('installation-wizard',true);screen('installation-editor');renderSimpleInstallationWizard();
}
function simpleWizardSteps(w){
 const defs=installationDefinitions[w.kind]||[];
 return [...defs.map(d=>({...d,title:d.label,choices:d.type==='roof-link'?w.roofs:d.options})),{key:'remarks',title:'Opmerking',type:'textarea'},{key:'name',title:'Naamgeving'}];
}
function renderSimpleInstallationWizard(){
 const w=simpleInstallationWizard;if(!w)return;
 const steps=simpleWizardSteps(w),step=steps[w.step],host=$('installation-wizard');host.replaceChildren();
 const root=document.createElement('div');root.className='epc-wizard-step epc-heating-wizard';
 const top=document.createElement('div');top.className='epc-wizard-top';
 if(w.step>0){const back=document.createElement('button');back.type='button';back.className='epc-wizard-back';const img=document.createElement('img');img.src='ico/vorige-pijl.svg';img.alt='Vorige';back.append(img);back.onclick=()=>{w.step--;renderSimpleInstallationWizard()};top.append(back)}
 const progress=document.createElement('span');progress.className='epc-wizard-progress';progress.textContent=(w.step+1)+' / '+steps.length;top.append(progress);root.append(top);
 const title=document.createElement('h3');title.textContent=step.title;root.append(title);
 const next=()=>{w.step++;renderSimpleInstallationWizard()};
 if(step.choices?.length){const grid=document.createElement('div');grid.className='epc-wizard-grid';for(const value of step.choices){const b=document.createElement('button');b.type='button';b.className='epc-wizard-choice'+(w.values[step.key]===value?' selected':'');b.textContent=value;b.onclick=()=>{w.values[step.key]=value;next()};grid.append(b)}root.append(grid)}
 else{const input=document.createElement(step.type==='textarea'?'textarea':'input');input.className='epc-wizard-input';if(step.type==='number'){input.type='number';input.min=step.key==='quantity'?'1':'0';input.step=step.key==='quantity'?'1':'any';input.inputMode='decimal'}
 const prefix=w.kind==='solar_thermal'?'Zonneboiler':w.kind==='pv'?'PV':'Verlichting';
 const defaultName=prefix+' '+(w.existing.reduce((n,x)=>{const m=x.match(new RegExp('^'+prefix+'\\s+(\\d+)$','i'));return m?Math.max(n,Number(m[1])):n},0)+1);
 input.value=w.values[step.key]??(step.key==='name'?defaultName:'');input.placeholder=step.title;input.oninput=()=>{w.values[step.key]=input.value};root.append(input);
 const b=document.createElement('button');b.type='button';b.className='epc-wizard-next';b.textContent=step.key==='name'?'Opslaan':'Volgende';b.onclick=()=>{const value=input.value.trim();if(step.key!=='remarks'&&!value){note('Vul '+step.title.toLocaleLowerCase('nl-BE')+' in.');input.focus();return}if(step.type==='number'&&(!Number.isFinite(Number(value))||Number(value)<=0||(step.key==='quantity'&&!Number.isInteger(Number(value))))){note('Vul een geldig positief getal in.');input.focus();return}w.values[step.key]=value;if(step.key==='name')saveSimpleInstallationWizard();else next()};root.append(b)}host.append(root);
}
async function saveSimpleInstallationWizard(){
 const w=simpleInstallationWizard;if(!w)return;const name=String(w.values.name||'').trim();if(!name)return note('Vul een naam in.');
 if(w.existing.some(x=>x.toLocaleLowerCase('nl-BE')===name.toLocaleLowerCase('nl-BE')))return note('Deze naam bestaat al. Kies een andere naam.');
 const {name:ignored,remarks,...details}=w.values;
 const {error}=await db.from('epc_installation_entries').insert({dossier_id:activeDossier.id,section_id:activeInstallationSection.id,name,remarks:remarks||null,details});if(error)return err(error);
 simpleInstallationWizard=null;show('installation-wizard',false);show('installation-form',true);screen('installation-page');await loadInstallationEntries();await loadSectionPhotos('installation',activeInstallationSection.id,'installation-page');note('Installatie opgeslagen.');
}
// Opwekker SWW: conditionele wizard op basis van het aangeleverde schema.
let swwWizard=null;
function swwSteps(v,systems){
 const steps=[{key:'type',title:'Soort SWW',choices:['Individueel','Collectief']}];
 if(!v.type)return steps;
 if(v.type==='Individueel'){
  steps.push({key:'heating',title:'Koppeling verwarming',choices:['Los van CV',...systems]});
  if(!v.heating)return steps;
 }
 if(v.type==='Collectief'||v.heating==='Los van CV'){
  steps.push({key:'energy',title:'Energiedrager',choices:['Gas','Stookolie','Elektriciteit']});
  if(!v.energy)return steps;
  if(v.energy==='Gas')steps.push({key:'sww_generator',title:'Type opwekker',choices:['WP boiler','Ketel']});
  if(v.energy==='Elektriciteit')steps.push({key:'sww_generator',title:'Type opwekker',choices:['WP boiler','Elektrische weerstandsverwarming']});
  if(['Gas','Elektriciteit'].includes(v.energy)&&!v.sww_generator)return steps;
 }
 steps.push({key:'tank_present',title:'Voorraadvat',choices:['Nee','Ja']});
 if(!v.tank_present)return steps;
 if(v.tank_present==='Ja'){
  steps.push({key:'tank_method',title:'Volumebepaling',choices:['Omtrek + hoogte','Volume invoer']});
  if(!v.tank_method)return steps;
  if(v.tank_method==='Omtrek + hoogte')steps.push({key:'tank_dimensions',title:'Afmetingen voorraadvat',fields:[['tank_circumference','Omtrek (cm)'],['tank_height','Hoogte (cm)']]});
  else steps.push({key:'tank_volume',title:'Volume voorraadvat',fields:[['tank','Volume (liter)']]});
  steps.push({key:'tank_insulation',title:'Isolatie voorraadvat',choices:['Nee','Ja','Onbekend']});
  if(!v.tank_insulation)return steps;
 }
 steps.push({key:'pipes_type',title:'Leidingen',choices:['Circulatieleidingen','Gewone leidingen']});
 if(!v.pipes_type)return steps;
 if(v.pipes_type==='Circulatieleidingen')steps.push({key:'pipes_insulation',title:'Isolatie circulatieleidingen',choices:['Geïsoleerd','Niet geïsoleerd','Onbekend']});
 else steps.push({key:'pipes_length',title:'Lengte gewone leidingen',choices:['> 5 m','≤ 5 m']});
 if(!v[v.pipes_type==='Circulatieleidingen'?'pipes_insulation':'pipes_length'])return steps;
 steps.push({key:'device',title:'Overige gegevens',fields:[['brand','Merk'],['model','Type / model'],['year','Referentiejaar fabricage'],['remarks','Opmerking']]});
 steps.push({key:'name',title:'Naamgeving'});return steps;
}
async function startSwwWizard(){
 const {data:existing,error}=await db.from('epc_installation_entries').select('name').eq('dossier_id',activeDossier.id).eq('section_id',activeInstallationSection.id).is('deleted_at',null);
 if(error)return err(error);
 const {data:sections,error:sectionError}=await db.from('epc_installation_sections').select('id').eq('dossier_id',activeDossier.id).eq('kind','heating_system').is('deleted_at',null);
 if(sectionError)return err(sectionError);
 const systems=[];
 for(const section of sections||[]){const {data,error:e}=await db.from('epc_installation_entries').select('id,name').eq('dossier_id',activeDossier.id).eq('section_id',section.id).is('deleted_at',null);if(e)return err(e);systems.push(...(data||[]))}
 swwWizard={step:0,values:{},names:(existing||[]).map(x=>x.name),systems};activeInstallation=null;
 $('installation-edit-title').textContent='Nieuwe opwekker SWW';$('installation-edit-icon').replaceChildren(iconFor('Opwekker SWW'));
 show('installation-form',false);show('installation-wizard',true);screen('installation-editor');renderSwwWizard();
}
function renderSwwWizard(){
 const w=swwWizard;if(!w)return;const steps=swwSteps(w.values,w.systems.map(x=>x.name));w.step=Math.min(w.step,steps.length-1);
 const step=steps[w.step],host=$('installation-wizard');host.replaceChildren();
 const root=document.createElement('div');root.className='epc-wizard-step epc-heating-wizard';
 const top=document.createElement('div');top.className='epc-wizard-top';
 if(w.step){const back=document.createElement('button');back.type='button';back.className='epc-wizard-back';const img=document.createElement('img');img.src='ico/vorige-pijl.svg';img.alt='Vorige';back.append(img);back.onclick=()=>{w.step--;renderSwwWizard()};top.append(back)}
 const title=document.createElement('strong');title.textContent=step.title;top.append(title);
 const progress=document.createElement('span');progress.className='epc-wizard-progress';progress.textContent=(w.step+1)+' / '+steps.length;top.append(progress);root.append(top);
 const next=()=>{w.step++;renderSwwWizard()};
 if(step.choices){const grid=document.createElement('div');grid.className='epc-wizard-grid';for(const choice of step.choices){const b=document.createElement('button');b.type='button';b.className='epc-wizard-choice'+(w.values[step.key]===choice?' selected':'');b.textContent=choice;b.onclick=()=>{
  if(w.values[step.key]!==choice){
   if(step.key==='type'){for(const k of ['heating','energy','sww_generator'])delete w.values[k]}
   if(step.key==='heating'){delete w.values.energy;delete w.values.sww_generator}
   if(step.key==='energy')delete w.values.sww_generator;
   if(step.key==='tank_present'&&choice==='Nee')for(const k of ['tank_method','tank_circumference','tank_height','tank','tank_insulation'])delete w.values[k];
   if(step.key==='tank_method')for(const k of ['tank_circumference','tank_height','tank'])delete w.values[k];
   if(step.key==='pipes_type'){delete w.values.pipes_insulation;delete w.values.pipes_length}
  }
  w.values[step.key]=choice;next()};grid.append(b)}root.append(grid)}
 else if(step.fields){const fields=document.createElement('div');fields.className='epc-heating-fields';const inputs=[];
  for(const [key,label] of step.fields){const wrap=document.createElement('label');wrap.className='epc-heating-field';wrap.textContent=label;const el=document.createElement(key==='remarks'?'textarea':'input');el.className='epc-wizard-input';el.value=w.values[key]??'';if(['tank','tank_circumference','tank_height','year'].includes(key)){el.type='number';el.min='0';el.step=key==='year'?'1':'any'}el.oninput=()=>{w.values[key]=el.value};wrap.append(el);fields.append(wrap);inputs.push([key,el])}
  root.append(fields);const b=document.createElement('button');b.type='button';b.className='epc-wizard-next';b.textContent='Volgende';b.onclick=()=>{if(step.key==='tank_dimensions'&&(!Number(w.values.tank_circumference)||!Number(w.values.tank_height))){note('Vul omtrek en hoogte in.');return}if(step.key==='tank_volume'&&!Number(w.values.tank)){note('Vul het volume in.');return}next()};root.append(b);
 }else if(step.key==='name'){
  const input=document.createElement('input');input.className='epc-wizard-input';input.value=w.values.name??['SWW',w.values.brand,w.values.model].filter(Boolean).join('-');input.placeholder='Naam opwekker SWW';input.oninput=()=>{w.values.name=input.value};root.append(input);
  const b=document.createElement('button');b.type='button';b.className='epc-wizard-next';b.textContent='Opslaan';b.onclick=()=>{w.values.name=input.value.trim();saveSwwWizard()};root.append(b)
 }
 host.append(root);
}
async function saveSwwWizard(){
 const w=swwWizard;if(!w)return;const name=String(w.values.name||'').trim();if(!name){note('Vul een naam in.');return}
 if(w.names.some(x=>x.toLocaleLowerCase('nl-BE')===name.toLocaleLowerCase('nl-BE'))){note('Deze naam bestaat al. Kies een andere naam.');return}
 const {name:ignored,remarks,...details}=w.values;
 if(details.type==='Individueel'&&details.heating&&details.heating!=='Los van CV'){
  const linked=w.systems.find(x=>x.name===details.heating);if(linked)details.heating_system_id=linked.id;
 }
 const {error}=await db.from('epc_installation_entries').insert({dossier_id:activeDossier.id,section_id:activeInstallationSection.id,name,remarks:remarks||null,details});if(error)return err(error);
 swwWizard=null;show('installation-wizard',false);show('installation-form',true);screen('installation-page');await loadInstallationEntries();await loadSectionPhotos('installation',activeInstallationSection.id,'installation-page');note('Opwekker SWW opgeslagen.');
}
// Verwarming: één gedeelde tegelwizard, met voorwaardelijke stappen volgens de aangeleverde schema's.
let heatingWizard=null;
const HW=(key,title,choices,short=null)=>({key,title,choices,short});
const HP=['Lucht/lucht','Bodem/lucht','Water/lucht','Lucht/water','Bodem/water','Water/water'];
const HW_SHORT={'Lucht/lucht':'L/L','Bodem/lucht':'B/L','Water/lucht':'W/L','Lucht/water':'L/W','Bodem/water':'B/W','Water/water':'W/W','Oppervlakteverwarming':'VVW','Combinatie radiatoren/convectoren en oppervlakteverwarming':'RAD + VVW','Radiatoren/convectoren':'RAD','Luchtverwarming':'LUCHT','Onvolledig (enkel opwekker)':'ENKEL OPWEKKER','Onvolledig (enkel afgifte)':'ENKEL AFGIFTE'};
function heatingSteps(){
 const d=heatingWizard.values,steps=[];const add=(k,t,c)=>steps.push(HW(k,t,c));
 if(heatingWizard.kind==='heating'){
  add('generator','OPWEKKER',['Individueel','Collectief']);
  if(d.generator==='Collectief'){
   add('device_details','Toestelgegevens',null);
  }else{
   add('energy','ENERGIEDRAGER',['Gas','Stookolie','Hout','Pellets','Kolen','Warmtenet','Elektriciteit']);
   if(d.energy==='Gas')add('type','SOORT',['Condenserend','Niet-condenserend (open)','Niet-condenserend (gesloten)','WKK','Warmtepomp']);
   if(d.energy==='Stookolie')add('type','SOORT',['Condenserend','Niet-condenserend','WKK']);
   if(['Hout','Pellets'].includes(d.energy))add('type','SOORT',['Condenserend','Niet-condenserend']);
   if(d.energy==='Kolen')add('type','SOORT',['Niet-condenserend']);
   if(d.energy==='Warmtenet')add('type','SOORT',['Energie-efficiënt','Niet energie-efficiënt','Gedetailleerd']);
   if(d.energy==='Elektriciteit')add('type','SOORT',['Warmtepomp','Elektrische weerstandsverwarming']);
   if(d.type==='Warmtepomp')add('medium','BRON / AFGIFTEMEDIUM',HP);
   const labels=d.energy==='Gas'?(d.type==='Condenserend'?['Geen','CE','Energy Star','HR-top','Blaue Engel']:d.type?.startsWith('Niet-condenserend')?['Geen','BGV/AGB','HR BGV/AGB','HR+','CE','Energy Star']:[]):d.energy==='Stookolie'?(d.type==='Condenserend'?['CE','Energy Star','Optimaz Elite 2005']:d.type==='Niet-condenserend'?['Optimaz Oud','CE','Energy Star','Optimaz 2005']:[]):d.energy==='Hout'?['CE','Nordic Swann']:d.energy==='Pellets'?['CE','Blaue Engel','Nordic Swann']:d.energy==='Kolen'?['Geen','CE']:[];
   if(labels.length)add('label','LABEL',['Geen',...labels.filter(x=>x!=='Geen')]);
   if(labels.length)add('outside','BUITEN BESCHERMD VOLUME',['Nee','Ja']);
   add('device_details','Toestelgegevens',null);
  }
  if(heatingWizard.kind!=='heating')add('remarks','Opmerking',null);add('name','Naamgeving',null);
 }else{
  add('type','TYPE VERWARMING',['Geen','Onvolledig (enkel opwekker)','Onvolledig (enkel afgifte)','Centraal','Decentraal']);
  if(d.type==='Onvolledig (enkel opwekker)'){add('known_generator','OPWEKKER GEKEND?',['Nee','Ja']);if(d.known_generator==='Ja')add('generator_link','OPWEKKER VERWARMING',heatingWizard.generators)}
  if(d.type==='Onvolledig (enkel afgifte)'){
   add('known_emission','AFGIFTESYSTEEM GEKEND?',['Nee','Ja']);
   if(d.known_emission==='Ja')add('emission','TYPE AFGIFTESYSTEEM',['Oppervlakteverwarming','Combinatie radiatoren/convectoren en oppervlakteverwarming','Radiatoren/convectoren','Luchtverwarming','Onbekend']);
   if(['Radiatoren/convectoren','Combinatie radiatoren/convectoren en oppervlakteverwarming'].includes(d.emission))add('room_control','REGELING BINNENTEMPERATUUR',['Geen','Manueel','Thermostaatkranen']);
  }
  if(d.type==='Centraal'){
   add('generator_link','OPWEKKER VERWARMING',heatingWizard.generators);
   add('external','EXTERNE STOOKPLAATS',['Ja','Nee']);
   add('emission','TYPE AFGIFTESYSTEEM',['Oppervlakteverwarming','Combinatie radiatoren/convectoren en oppervlakteverwarming','Radiatoren/convectoren','Luchtverwarming','Onbekend']);
   if(['Oppervlakteverwarming','Combinatie radiatoren/convectoren en oppervlakteverwarming','Radiatoren/convectoren'].includes(d.emission))add('pump','POMPREGELING',['Ja','Nee','Onbekend']);
   if(['Radiatoren/convectoren','Combinatie radiatoren/convectoren en oppervlakteverwarming'].includes(d.emission))add('valves','RADIATORKRANEN',['Manueel','Thermostaatkranen']);
   if(d.emission)add('sensor',d.emission==='Oppervlakteverwarming'?'BUITENVOELER / BUITENVLOER':'BUITENVOELER',['Aanwezig','Afwezig']);
  }
  if(d.type==='Decentraal'){
   add('energy','ENERGIEDRAGER',['Gas','Stookolie','Kolen','Pellets','Hout','Elektriciteit']);
   if(d.energy==='Hout'){add('stove','SOORT',['Kachel','Accumulerende kachel']);add('year','REFERENTIEJAAR FABRICAGE',null)}
  }
  add('remarks','OPMERKING',null);add('name','NAAMGEVING',null);
 }
 return steps;
}
async function startHeatingWizard(entry){
 activeInstallation=entry;
 const kind=activeInstallationSection.kind;
 let generators=[];
 if(kind==='heating_system'){
  const {data:secs,error}=await db.from('epc_installation_sections').select('id').eq('dossier_id',activeDossier.id).eq('kind','heating').is('deleted_at',null);
  if(error)return err(error);
  for(const sec of secs||[]){const {data,error:e}=await db.from('epc_installation_entries').select('name').eq('section_id',sec.id).eq('dossier_id',activeDossier.id).is('deleted_at',null);if(e)return err(e);generators.push(...(data||[]).map(x=>x.name))}
  if(!generators.length&&!entry){note('Voeg eerst een opwekker verwarming toe.');return}
 }
 const {data:existing,error}=await db.from('epc_installation_entries').select('name').eq('section_id',activeInstallationSection.id).eq('dossier_id',activeDossier.id).is('deleted_at',null);
 if(error)return err(error);
 const values={...(entry?.details||{})};
 heatingWizard={kind,values,step:0,generators,existingNames:(existing||[]).map(x=>x.name),originalName:entry?.name||''};
 if(entry)values.name=entry.name;
 $('installation-edit-title').textContent=entry?activeInstallationSection.name:'Nieuwe '+activeInstallationSection.name.toLowerCase();
 $('installation-edit-icon').replaceChildren(iconFor(activeInstallationSection.name));
 show('installation-form',false);show('installation-wizard',true);screen('installation-editor');renderHeatingWizard();
}
function renderHeatingWizard(){
 const w=heatingWizard;if(!w)return;const steps=heatingSteps();w.step=Math.min(w.step,steps.length-1);
 const current=steps[w.step],host=$('installation-wizard');host.replaceChildren();
 const root=document.createElement('div');root.className='epc-wizard-step epc-heating-wizard';
 const top=document.createElement('div');top.className='epc-wizard-top';
 if(w.step>0){const back=document.createElement('button');back.type='button';back.className='epc-wizard-back';const img=document.createElement('img');img.src='ico/vorige-pijl.svg';img.alt='Vorige';back.append(img);back.onclick=()=>{w.step--;renderHeatingWizard()};top.append(back)}
 const title=document.createElement('h2');title.textContent=current.title.toLocaleLowerCase('nl-BE').replace(/^./,c=>c.toLocaleUpperCase('nl-BE'));top.append(title);
 const progress=document.createElement('span');progress.className='epc-wizard-progress';progress.textContent=(w.step+1)+' / '+steps.length;top.append(progress);root.append(top);
 const advance=()=>{w.step=Math.min(w.step+1,heatingSteps().length-1);renderHeatingWizard()};
 if(current.choices){const grid=document.createElement('div');grid.className='epc-wizard-grid';for(const value of current.choices){const b=document.createElement('button');b.type='button';b.className='epc-wizard-choice'+(w.values[current.key]===value?' selected':'');b.textContent=HW_SHORT[value]||value;b.title=value;b.lang='nl';b.onclick=()=>{w.values[current.key]=value;const keys=heatingSteps().map(x=>x.key);for(const k of Object.keys(w.values)){if(!keys.includes(k)&&k!=='name')delete w.values[k]}advance()};grid.append(b)}root.append(grid)}
 else if(current.key==='device_details'){const fields=document.createElement('div');fields.className='epc-heating-fields';for(const [key,label,tag] of [['brand','Merk','input'],['model','Type / model','input'],['year','Referentiejaar fabricage','input'],['remarks','Opmerking','textarea']]){const wrap=document.createElement('label');wrap.className='epc-heating-field';wrap.textContent=label;const field=document.createElement(tag);field.className='epc-wizard-input';field.value=w.values[key]||'';if(key==='year'){field.type='number';field.min='1800';field.max='2100'}field.oninput=()=>{w.values[key]=field.value};wrap.append(field);fields.append(wrap)}root.append(fields);const next=document.createElement('button');next.type='button';next.className='epc-wizard-next';next.textContent='Volgende';next.onclick=advance;root.append(next)}
 else{const input=document.createElement(current.key==='remarks'?'textarea':'input');input.className='epc-wizard-input';input.placeholder=current.title==='NAAMGEVING'?'Naam':current.title;input.value=w.values[current.key]??(current.key==='name'?(w.kind==='heating'?'OPW-'+[w.values.brand,w.values.model].filter(Boolean).join('-'):'RV '+(w.existingNames.filter(x=>/^RV\s*\d+$/i.test(x)).reduce((m,x)=>Math.max(m,Number(x.match(/\d+/)[0])),0)+1)):'');if(current.key==='year'){input.type='number';input.min='1800';input.max='2100'}input.oninput=()=>{w.values[current.key]=input.value};root.append(input);
 const next=document.createElement('button');next.type='button';next.className='epc-wizard-next';next.textContent=current.key==='name'?'Opslaan':'Volgende';next.onclick=async()=>{const value=input.value.trim();if(current.key==='name'){if(!value){note('Vul een naam in.');input.focus();return}w.values.name=value;await saveHeatingWizard()}else{w.values[current.key]=value;advance()}};root.append(next)}
 host.append(root);window.scrollTo({top:0,behavior:'instant'});
}
async function saveHeatingWizard(){
 const w=heatingWizard;if(!w)return;
 const name=String(w.values.name||'').trim();
 if(w.existingNames.some(x=>x.toLocaleLowerCase('nl-BE')===name.toLocaleLowerCase('nl-BE')&&x!==w.originalName)){note('Deze naam bestaat al. Kies een andere naam.');return}
 if(w.kind==='heating_system'&&(w.values.type==='Centraal'||(w.values.type==='Onvolledig (enkel opwekker)'&&w.values.known_generator==='Ja'))&&!w.values.generator_link){note('Selecteer een opwekker.');return}
 const {name:ignored,remarks,...details}=w.values;
 const payload={dossier_id:activeDossier.id,section_id:activeInstallationSection.id,name,remarks:remarks||null,details};
 const {error}=activeInstallation?await db.from('epc_installation_entries').update(payload).eq('id',activeInstallation.id).eq('dossier_id',activeDossier.id):await db.from('epc_installation_entries').insert(payload);
 if(error)return err(error);
 heatingWizard=null;show('installation-wizard',false);show('installation-form',true);screen('installation-page');await loadInstallationEntries();await loadSectionPhotos('installation',activeInstallationSection.id,'installation-page');note('Installatie opgeslagen.');
}


// Openingen per gevelconstructie; types zijn dossierbreed herbruikbaar.
let openingConstruction=null, openingRecord=null, openingType=null, openingDraft={}, openingStep=0, openingMode='wizard';
const openingProfiles=['Geen profiel','Metaal, NTO','Metaal, TO','Alu, TO ≥ 2000','Alu, TO ≥ 2015','PVC, 1K of onbekend','PVC, ≥ 2K','PVC, ≥ 2K, ≥ 2000','Hout','Hout, ≥ 100 mm','Hout, ≥ 150 mm'];
const openingInsulation=['Geen isolatie','Onbekend','MW','PUR/PIR','XPS','EPS','Andere'];
const openingSpecs={
 kind:{label:'Type opening',options:['Glas','Deur','Paneel']},
 width_cm:{label:'Breedte (cm)',type:'number'},height_cm:{label:'Hoogte (cm)',type:'number'},quantity:{label:'Aantal',type:'number'},
 spacer:{label:'Afstandshouder',options:['Geen aanduiding','HR+','HR++']},
 glazing:{label:'Glastype',options:['EG','PC (2 à 3W)','Glasdals','DG','PC (4W)','3DG geen coating','HR < 2000','HR ≥ 2000','3DG met coating']},
 profile:{label:'Profiel',options:openingProfiles},
 shading:{label:'Buitenzonwering',options:['Niet aanwezig','Manueel','Automatisch','Vast']},
 insulation:{label:'Isolatie',options:openingInsulation}, thickness:{label:'Isolatiedikte (mm)',type:'number'},
 renovation:{label:'Referentiejaar renovatie',type:'number'},air:{label:'Luchtlaag',options:['Afwezig','Onbekend','Aanwezig']},
 panel_type:{label:'Paneeltype',options:['Metaal','Niet-metaal']},door_type:{label:'Deurtype',options:['Metaal','Niet-metaal']},
 name:{label:'Naam',type:'text'}
};
function openingKeys(d){const k=d.kind;const fields=['kind','width_cm','height_cm','quantity'];
 if(k==='Glas')fields.push('spacer','glazing','profile','shading');
 if(k==='Deur'||k==='Paneel'){
  fields.push('insulation');if(d.insulation&&!['Geen isolatie','Onbekend'].includes(d.insulation))fields.push('thickness');
  if(d.insulation==='Onbekend')fields.push('renovation');
  fields.push('air',k==='Deur'?'door_type':'panel_type','profile');
 }
 fields.push('name');return fields;
}
function openingButton(text,click,cls=''){const b=document.createElement('button');b.type='button';b.textContent=text;b.className=cls;b.onclick=click;return b}
function openingField(key,draft,change){const spec=openingSpecs[key],wrap=document.createElement('div');wrap.className='opening-field';
 const title=document.createElement('strong');title.textContent=spec.label;wrap.append(title);
 if(spec.options){const grid=document.createElement('div');grid.className='opening-choices';for(const option of spec.options){
  const b=openingButton(option,()=>change(key,option),'opening-choice'+(draft[key]===option?' selected':''));grid.append(b);
 }wrap.append(grid)}else{const inp=document.createElement('input');inp.type=spec.type||'text';inp.value=draft[key]??'';inp.placeholder=spec.label;
 if(inp.type==='number'){inp.min=key==='quantity'?'1':'0';inp.step=key==='renovation'||key==='quantity'?'1':'any'}
 inp.oninput=()=>{draft[key]=inp.value};wrap.append(inp)}return wrap;
}
async function openConstructionOpenings(c){openingConstruction=c;openingRecord=null;$('opening-page-title').textContent=c.name;screen('opening-page');await loadOpeningRows()}
async function loadOpeningRows(){const {data,error}=await db.from('epc_openings').select('*,epc_opening_types(*)').eq('dossier_id',activeDossier.id).eq('facade_construction_id',openingConstruction.id).is('deleted_at',null).order('created_at');if(error)return err(error);
 const host=$('opening-list');host.replaceChildren();if(!data?.length){const p=document.createElement('p');p.textContent='Nog geen openingen toegevoegd.';host.append(p)}
 for(const o of data||[]){const row=document.createElement('div');row.className='construction-list-item';const b=openingButton(o.name+'  ›',()=>openOpeningEditor(o),'construction-row');const del=openingButton('🗑',async()=>{if(!confirm('Opening "'+o.name+'" verwijderen?'))return;const {error}=await db.from('epc_openings').update({deleted_at:new Date().toISOString()}).eq('id',o.id).eq('dossier_id',activeDossier.id);if(error)return err(error);await loadOpeningRows()},'construction-item-delete');row.append(b,del);host.append(row)}
}
function openingStepKeys(){const k=openingDraft.kind;const arr=[['kind'],['width_cm','height_cm','quantity']];
 if(k==='Glas')arr.push(['spacer'],['glazing'],['profile'],['shading']);
 if(k==='Deur'||k==='Paneel'){arr.push(['insulation']);if(openingDraft.insulation&&!['Geen isolatie','Onbekend'].includes(openingDraft.insulation))arr.push(['thickness']);if(openingDraft.insulation==='Onbekend')arr.push(['renovation']);arr.push(['air'],[k==='Deur'?'door_type':'panel_type'],['profile'])}
 arr.push(['name']);return arr;
}
function openingRenderWizard(){
 const host=$('opening-editor-content');host.replaceChildren();const steps=openingStepKeys();openingStep=Math.min(openingStep,steps.length-1);
 const keys=steps[openingStep];const choiceOnly=keys.length===1&&!!openingSpecs[keys[0]]?.options;
 const label=document.createElement('h2');label.textContent='Stap '+(openingStep+1)+' van '+steps.length;host.append(label);
 for(const key of keys)host.append(openingField(key,openingDraft,(k,v)=>{
  const changed=openingDraft[k]!==v;openingDraft[k]=v;
  if(k==='kind'&&changed){for(const old of Object.keys(openingDraft))if(!['kind','width_cm','height_cm','quantity','name'].includes(old))delete openingDraft[old]}
  if(choiceOnly&&openingStep<openingStepKeys().length-1){openingStep++;openingRenderWizard();}
  else openingRenderWizard();
 }));
 const actions=document.createElement('div');actions.className='opening-actions';
 if(openingStep)actions.append(openingButton('Vorige',()=>{openingStep--;openingRenderWizard()},'secondary'));
 if(!choiceOnly){actions.append(openingButton(openingStep===steps.length-1?'Opslaan':'Volgende',async()=>{
  if(keys.some(k=>!String(openingDraft[k]??'').trim())){note('Vul eerst alle gegevens van deze stap in.');return}
  if(openingStep<openingStepKeys().length-1){openingStep++;openingRenderWizard()}else await saveOpening();
 },'epc-wizard-next'))}
 host.append(actions);
}
function openingRenderOverview(){const host=$('opening-editor-content');host.replaceChildren();const hint=document.createElement('p');hint.textContent='Tik op een gegeven om het afzonderlijk te bekijken of aan te passen.';host.append(hint);
 for(const key of openingKeys(openingDraft)){const row=document.createElement('div');row.className='opening-overview-row';const title=document.createElement('strong');title.textContent=openingSpecs[key].label;const val=openingButton(String(openingDraft[key]??'Niet ingevuld')+'  ›',()=>{
  const existing=row.querySelector('.opening-inline');if(existing){existing.remove();return}
  const draft={...openingDraft};const editor=document.createElement('div');editor.className='opening-inline';const field=openingField(key,draft,(k,v)=>{draft[k]=v;field.replaceWith(openingField(key,draft,(kk,vv)=>{draft[kk]=vv}))});editor.append(field);
  editor.append(openingButton('Bevestigen',()=>{openingDraft={...draft};openingRenderOverview()},'epc-wizard-next'));row.append(editor);
 },'epc-overview-value');row.append(title,val);host.append(row)}
 host.append(openingButton('Wijzigingen opslaan',saveOpening,'epc-overview-save'));
}
function openOpeningEditor(o=null){openingRecord=o;openingType=o?.epc_opening_types||null;
 openingDraft=o?{...openingType?.details,kind:openingType?.kind||'Glas',name:o.name,width_cm:o.width_cm,height_cm:o.height_cm,quantity:o.quantity,shading:o.sun_shading,profile:openingType?.profile_type,glazing:openingType?.glazing_type,spacer:openingType?.glazing_holder_marking}:{kind:'',width_cm:'',height_cm:'',quantity:1,name:''};
 openingStep=0;$('opening-editor-title').textContent=o?o.name:'Nieuwe opening';screen('opening-editor');if(o)openingRenderOverview();else openingRenderWizard();
}
async function saveOpening(){const d=openingDraft;if(!d.name?.trim()||!d.kind||!(Number(d.width_cm)>0)||!(Number(d.height_cm)>0)||!(Number(d.quantity)>0)){note('Vul naam, type, geldige afmetingen en aantal in.');return}
 const details={};for(const k of openingKeys(d))if(!['name','kind','width_cm','height_cm','quantity','profile','glazing','spacer','shading'].includes(k))details[k]=d[k]??null;
 const typePayload={dossier_id:activeDossier.id,name:d.name.trim(),kind:d.kind,details,profile_type:d.profile||null,glazing_type:d.glazing||null,glazing_holder_marking:d.spacer||null};
 // Wijzig een gedeeld openingstype niet stilzwijgend voor andere openingen: maak bij bewerken een eigen type.
 const {data:type,error:typeError}=await db.from('epc_opening_types').insert(typePayload).select('id').single();if(typeError)return err(typeError);
 const payload={dossier_id:activeDossier.id,facade_construction_id:openingConstruction.id,opening_type_id:type.id,name:d.name.trim(),width_cm:Number(d.width_cm),height_cm:Number(d.height_cm),quantity:Number(d.quantity),sun_shading:d.shading||null};
 const {error}=openingRecord?await db.from('epc_openings').update(payload).eq('id',openingRecord.id).eq('dossier_id',activeDossier.id):await db.from('epc_openings').insert(payload);
 if(error)return err(error);screen('opening-page');await loadOpeningRows();note('Opening opgeslagen.');
}
async function openingShowDrawer(){const {data,error}=await db.from('epc_openings').select('name,opening_type_id,epc_opening_types(*)').eq('dossier_id',activeDossier.id).is('deleted_at',null);if(error)return err(error);
 const host=$('opening-drawer-items');host.replaceChildren();host.append(openingButton('Nieuwe opening',()=>{openingCloseDrawer();openOpeningEditor()},'add-option'));
 const seen=new Set();for(const o of data||[]){if(!o.opening_type_id||seen.has(o.opening_type_id))continue;seen.add(o.opening_type_id);
 host.append(openingButton(o.name,async()=>{const {data:type,error:e}=await db.from('epc_opening_types').select('*').eq('id',o.opening_type_id).eq('dossier_id',activeDossier.id).single();if(e)return err(e);
 openingCloseDrawer();openingRecord=null;openingType=type;openingDraft={...type.details,kind:type.kind,name:o.name,width_cm:'',height_cm:'',quantity:1,profile:type.profile_type,glazing:type.glazing_type,spacer:type.glazing_holder_marking};openingStep=1;$('opening-editor-title').textContent='Opening hergebruiken';screen('opening-editor');openingRenderWizard();
 },'add-option'))}
 show('opening-overlay');show('opening-drawer');
}
function openingCloseDrawer(){show('opening-overlay',false);show('opening-drawer',false)}
$('opening-back').onclick=()=>{screen('facade-page');loadConstructions()};
$('opening-editor-back').onclick=()=>{screen('opening-page');loadOpeningRows()};
$('opening-add').onclick=openingShowDrawer;$('opening-overlay').onclick=$('opening-drawer-close').onclick=openingCloseDrawer;

init();})();
