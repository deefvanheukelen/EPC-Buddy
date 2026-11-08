const epcIcons={"Voorgevel": "voorgevel.svg", "Achtergevel": "achtergevel.svg", "Linkergevel": "linkergevel.svg", "Rechtergevel": "rechtergevel.svg", "Hellend dak voor": "hellend-dak-voor.svg", "Hellend dak achter": "hellend-dak-achter.svg", "Hellend dak links": "hellend-dak-links.svg", "Hellend dak rechts": "hellend-dak-rechts.svg", "Plat dak": "plat-dak.svg", "Plafond": "plafond.svg", "Vloer": "vloer.svg", "Opwekker verwarming": "opwekker-verwarming.svg", "Actieve koeling": "actieve-koeling.svg", "Opwekker sanitair warm water": "opwekker-sanitair-warm-water.svg", "Continue ventilatie-eenheid": "continu-draaiend-ventilatietoestel.svg", "Ventilatie - Ruimte": "ventilatie-ruimte.svg", "Zonneboiler": "zonneboiler.svg", "PV-panelen": "pv-panelen.svg", "Verlichting": "verlichting.svg"};
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
function screen(id){activeScreen=id;persistInspectionView();['auth','home','editor','detail','facade-page','construction-editor','envelope-editor','envelope-page','installation-page','installation-editor'].forEach(x=>show(x,x===id));show('logout',!!user);show('header-home',!!user);document.body.classList.toggle('app-logged-in',!!user);requestAnimationFrame(refreshScrollTop)}
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
function edit(d){current=d?.id||null;f.reset();$('editor-title').textContent=d?'Dossier '+(d.dossier_number||''):'Nieuw dossier';show('delete-dossier',!!d);$('back').setAttribute('aria-label',d?'Terug naar dossier':'Terug naar dossiers');screen('editor');if(d){for(const k of ['dossier_number','inspection_date','client_kind','client_name','client_vat_number','client_phone','client_email'])field(k).value=d[k]||'';for(const [prefix,obj] of [['client',d.client_address],['property',d.property_address]])for(const k of ['street','number','postal','city'])field(prefix+'_'+k).value=obj?.[k]||'';$('same').checked=!!d.client_address_same_as_property;field('dossier_type').value=d.dossier_type||'RES'}toggle()}
async function open(id){
 const {data,error}=await db.from('epc_dossiers').select('*').eq('id',id).eq('workspace_id',workspace).single();
 if(error)return err(error);
 activeDossier=data;screen('detail');renderDetail();await loadFacades();window.scrollTo({top:0,behavior:'instant'});
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
async function loadFacades(){
 if(!activeDossier)return;
 const {data,error}=await db.from('epc_facades').select('id,name,remarks').eq('dossier_id',activeDossier.id).is('deleted_at',null).order('created_at',{ascending:true});
 if(error){err(error);return}
 const {data:envelopes,error:envelopeError}=await db.from('epc_envelope_elements')
  .select('*').eq('dossier_id',activeDossier.id).is('deleted_at',null).order('created_at',{ascending:true});
 if(envelopeError){err(envelopeError);return}
 const {data:envelopeChildren,error:childError}=await db.from('epc_envelope_constructions').select('envelope_id').eq('dossier_id',activeDossier.id).is('deleted_at',null);
 if(childError){err(childError);return}
 const envelopeCounts=new Map();for(const c of envelopeChildren||[])envelopeCounts.set(c.envelope_id,(envelopeCounts.get(c.envelope_id)||0)+1);
 const {data:installationSections,error:installationError}=await db.from('epc_installation_sections').select('*').eq('dossier_id',activeDossier.id).is('deleted_at',null);
 if(installationError)return err(installationError);
 const {data:installationEntries,error:installationEntriesError}=await db.from('epc_installation_entries').select('section_id').eq('dossier_id',activeDossier.id).is('deleted_at',null);
 if(installationEntriesError)return err(installationEntriesError);
 const installationCounts=new Map();for(const x of installationEntries||[])installationCounts.set(x.section_id,(installationCounts.get(x.section_id)||0)+1);
 const host=$('facade-list');host.replaceChildren();
 // Gevelconstructies per gevel ophalen; niet afleiden uit de opmerking van de gevel.
 const {data:constructions, error:constructionError}=await db.from('epc_facade_constructions')
   .select('facade_id').eq('dossier_id',activeDossier.id).is('deleted_at',null);
 if(constructionError){err(constructionError);return}
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
  b.append(icon,t,arrow);b.onclick=()=>editConstruction(d);
  const del=document.createElement('button');del.type='button';del.className='construction-item-delete';
  del.title='Verwijder uit deze gevel';del.setAttribute('aria-label','Verwijder '+d.name+' uit '+activeFacade.name);
  const img=document.createElement('img');img.src='ico/delete.svg';img.alt='';img.className='delete-icon';del.append(img);
  del.onclick=()=>removeConstructionFromFacade(d);
  row.append(b,del);host.append(row);
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
const cf=$('construction-form');
function editConstruction(d){activeConstruction=d||null;cf.reset();$('construction-heading').textContent=d?'Gevelconstructie':'Nieuwe gevelconstructie';show('construction-delete',!!d);if(d){for(const el of cf.elements){if(!el.name)continue;const value=d[el.name];el.value=value===null||value===undefined?'':typeof value==='boolean'?String(value):String(value)}}screen('construction-editor');window.scrollTo({top:0,behavior:'instant'})}
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
  r=await db.from('epc_facade_constructions').insert({...payload,dossier_id:activeDossier.id,facade_id:activeFacade.id}).select('id').single();
 }if(r.error)throw r.error;screen('facade-page');await loadConstructions();await loadSectionPhotos('facade',activeFacade.id,'facade-page');note('Gevelconstructie opgeslagen.')}catch(ex){err(ex)}finally{$('construction-save').disabled=false}};

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
 show('envelope-delete',!!record);screen('envelope-editor');window.scrollTo({top:0,behavior:'instant'});
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
   if((all||[]).some(x=>x.envelope_id===activeEnvelopeRecord.id&&norm(x.name)===norm(payload.name)))throw new Error('Deze constructie is al toegevoegd.');
   const {error}=await db.from('epc_envelope_constructions').insert(payload);if(error)throw error;
  }
  screen('envelope-page');await loadEnvelopeConstructions();note('Constructie opgeslagen.');
 }catch(ex){err(ex)}finally{button.disabled=false}
};
// Installaties: één sectie per type en meerdere items per sectie.
// Formuliervelden komen uit de eerder opgegeven EPC Buddy-specificatie.
// Waar exacte EPC-keuzelijsten niet vastliggen, gebruiken we een tekstveld.
const installationKinds=new Map([['Opwekker verwarming','heating'],['Actieve koeling','cooling'],['Opwekker sanitair warm water','hot_water'],['Continue ventilatie-eenheid','ventilation_unit'],['Ventilatie - Ruimte','room_ventilation'],['Zonneboiler','solar_thermal'],['PV-panelen','pv'],['Verlichting','lighting']]);
const I=(key,label,type='text',options=null)=>({key,label,type,options});
// Centrale formulierdefinities per installatietype. Geen ongeverifieerde EPC-keuzelijsten.
// Eén centrale configuratie per installatietype. Opties zijn uitsluitend afkomstig
// uit de door de gebruiker opgegeven EPC Buddy-specificaties.
// Bij ontbrekende keuzewaarden blijft het veld voorlopig vrij invulbaar.
const installationDefinitions={
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
async function openInstallationSection(section){activeInstallationSection=section;activeInstallation=null;$('installation-title').textContent=section.name;$('installation-icon').replaceChildren(iconFor(section.name));screen('installation-page');await loadInstallationEntries();await loadSectionPhotos('installation',section.id,'installation-page');window.scrollTo({top:0,behavior:'instant'})}
async function loadInstallationEntries(){
 const {data,error}=await db.from('epc_installation_entries').select('*').eq('dossier_id',activeDossier.id).eq('section_id',activeInstallationSection.id).is('deleted_at',null).order('created_at',{ascending:true});
 if(error)return err(error);const host=$('installation-list');host.replaceChildren();
 if(!data?.length){const p=document.createElement('p');p.className='construction-empty';p.textContent='Nog geen installaties toegevoegd.';host.append(p)}
 for(const entry of data||[]){
  const row=document.createElement('div');row.className='construction-list-item';const b=document.createElement('button');b.type='button';b.className='construction-row';
  const icon=document.createElement('span');icon.className='construction-icon';icon.append(iconFor(activeInstallationSection.name));
  const txt=document.createElement('span');txt.className='facade-text';const name=document.createElement('strong');name.textContent=entry.name;const sub=document.createElement('small');sub.textContent=activeInstallationSection.name;txt.append(name,sub);
  const arrow=document.createElement('span');arrow.className='row-chevron';arrow.textContent='›';b.append(icon,txt,arrow);b.onclick=()=>editInstallation(entry);
  const del=document.createElement('button');del.type='button';del.className='construction-item-delete';del.title='Installatie verwijderen';const img=document.createElement('img');img.src='ico/delete.svg';img.className='delete-icon';img.alt='';del.append(img);del.onclick=()=>removeInstallation(entry);
  row.append(b,del);host.append(row);
 }
}
async function editInstallation(entry=null){
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
async function removeInstallation(entry){if(!confirm('Installatie "'+entry.name+'" verwijderen?'))return false;const {error}=await db.from('epc_installation_entries').update({deleted_at:new Date().toISOString()}).eq('id',entry.id).eq('section_id',activeInstallationSection.id).eq('dossier_id',activeDossier.id);if(error){err(error);return false}await loadInstallationEntries();note('Installatie verwijderd.');return true}
$('installation-back').onclick=()=>{screen('detail');loadFacades()};
$('installation-section-delete').onclick=async()=>{
 if(!confirm(activeInstallationSection.name+' verwijderen, inclusief alle bijbehorende installaties?'))return;
 const stamp=new Date().toISOString();const {error:childrenError}=await db.from('epc_installation_entries').update({deleted_at:stamp}).eq('section_id',activeInstallationSection.id).eq('dossier_id',activeDossier.id).is('deleted_at',null);if(childrenError)return err(childrenError);
 const {error}=await db.from('epc_installation_sections').update({deleted_at:stamp}).eq('id',activeInstallationSection.id).eq('dossier_id',activeDossier.id);if(error)return err(error);
 activeInstallationSection=null;screen('detail');await loadFacades();note('Onderdeel verwijderd.');
};
$('installation-add').onclick=()=>editInstallation(null);
$('installation-edit-back').onclick=$('installation-cancel').onclick=()=>{screen('installation-page');loadInstallationEntries()};
$('installation-delete').onclick=async()=>{if(activeInstallation&&await removeInstallation(activeInstallation))screen('installation-page')};
$('installation-form').onsubmit=async event=>{
 event.preventDefault();const form=$('installation-form'),fd=new FormData(form),details={};for(const def of installationDefinitions[activeInstallationSection.kind]||[])details[def.key]=fd.get(def.key)||null;
 const payload={dossier_id:activeDossier.id,section_id:activeInstallationSection.id,name:String(fd.get('name')||'').trim(),remarks:String(fd.get('remarks')||'').trim()||null,details};
 const button=$('installation-save');button.disabled=true;try{
  const query=db.from('epc_installation_entries');const {error}=activeInstallation?await query.update(payload).eq('id',activeInstallation.id).eq('section_id',activeInstallationSection.id):await query.insert(payload);
  if(error)throw error;screen('installation-page');await loadInstallationEntries();await loadSectionPhotos('installation',activeInstallationSection.id,'installation-page');note('Installatie opgeslagen.');
 }catch(ex){err(ex)}finally{button.disabled=false}
};

const addItems=[['Voorgevel','facade'],['Achtergevel','facade'],['Linkergevel','facade'],['Rechtergevel','facade'],['Hellend dak voor','other'],['Hellend dak achter','other'],['Hellend dak links','other'],['Hellend dak rechts','other'],['Plat dak','other'],['Plafond','other'],['Vloer','other'],['Opwekker verwarming','other'],['Actieve koeling','other'],['Opwekker sanitair warm water','other'],['Continue ventilatie-eenheid','other'],['Ventilatie - Ruimte','other'],['Zonneboiler','other'],['PV-panelen','other'],['Verlichting','other']];
function closeDrawer(){closeConstructionDrawer();show('add-drawer',false);show('add-overlay',false);document.body.classList.remove('drawer-open')}
$('detail-add').onclick=async()=>{if(!activeDossier)return;const {data,error}=await db.from('epc_facades').select('name').eq('dossier_id',activeDossier.id).is('deleted_at',null);if(error)return err(error);const existing=new Set((data||[]).map(x=>x.name.toLocaleLowerCase()));
 const {data:existingEnvelope,error:envelopeError}=await db.from('epc_envelope_elements')
 .select('name').eq('dossier_id',activeDossier.id).is('deleted_at',null);
 if(envelopeError)return err(envelopeError);
 const envelopeNames=new Set((existingEnvelope||[]).map(x=>x.name.toLocaleLowerCase('nl-BE')));
 const {data:installedSections,error:installedError}=await db.from('epc_installation_sections').select('name').eq('dossier_id',activeDossier.id).is('deleted_at',null);
 if(installedError)return err(installedError);
 const installedNames=new Set((installedSections||[]).map(x=>x.name.toLocaleLowerCase('nl-BE')));
 const host=$('add-options');host.replaceChildren();for(const [name,type] of addItems){const b=document.createElement('button');b.type='button';b.className='add-option';b.append(iconFor(name),document.createTextNode(name));if((type==='facade'&&existing.has(name.toLocaleLowerCase()))||(envelopeKinds.has(name)&&envelopeNames.has(name.toLocaleLowerCase('nl-BE')))||(installationKinds.has(name)&&installedNames.has(name.toLocaleLowerCase('nl-BE')))){b.disabled=true;b.title='Deze gevel bestaat al';b.classList.add('already-added')}b.onclick=async()=>{if(envelopeKinds.has(name)){
  b.disabled=true;const {data:created,error:e}=await db.from('epc_envelope_elements').insert({dossier_id:activeDossier.id,element_kind:envelopeKinds.get(name),name}).select('*').single();
  if(e){b.disabled=false;return err(e)}closeDrawer();await loadFacades();note(name+' toegevoegd.');return;
 }
 if(installationKinds.has(name)){
  b.disabled=true;const {error:e}=await db.from('epc_installation_sections').insert({dossier_id:activeDossier.id,name,kind:installationKinds.get(name)});
  if(e){b.disabled=false;return err(e)}closeDrawer();await loadFacades();note(name+' toegevoegd.');return;
 }
 if(type!=='facade'){note('Dit onderdeel wordt in de volgende ontwikkelfase toegevoegd.');return}b.disabled=true;const r=await db.from('epc_facades').insert({dossier_id:activeDossier.id,name}).select('id').single();if(r.error){err(r.error);b.disabled=false;return}closeDrawer();await loadFacades();note(name+' toegevoegd.')};host.append(b)}show('add-overlay');show('add-drawer');document.body.classList.add('drawer-open')};
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
   if(activeDossier?.id===dossierId)renderSectionPhotos(host,photos,kind,targetId,page,dossierId);
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
  open.append(img);open.onclick=()=>openPhoto(photo.filename,photo.url,photo.created_at);
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
  const stamp=document.createElement('span');stamp.className='epc-photo-stamp';
  stamp.textContent=formatPhotoTimestamp(photo.created_at);
  const caption=document.createElement('span');caption.className='epc-photo-caption';caption.textContent=photo.filename;
  tile.append(open,del,stamp,caption);fragment.append(tile);
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
init();})();
