/* TEST read-only seat overlay. Live D1 section inventory is authoritative.
 * No seat selections, holds, checkout or ticket sales are enabled here.
 */
(()=>{
 'use strict';
 const grid=document.getElementById('seatgrid');
 const heading=document.getElementById('heading');
 if(!grid||!heading)return;
 const notice=document.createElement('div');
 notice.setAttribute('role','status');
 notice.setAttribute('aria-live','polite');
 notice.style.cssText='margin:12px 0;padding:12px;border:1px solid #81622c;background:#292216;color:#ffe4a1;border-radius:8px;font-size:13px';
 grid.parentElement.insertBefore(notice,grid);
 const labels={SOLD:'Sold',UNRELEASED:'Not released for sale',BLOCKED:'Blocked',HELD:'Held',AVAILABLE:'Sales disabled',UNAVAILABLE:'Unavailable'};
 let active='',generation=0,controller=null,rendering=false;
 const sectionFromHeading=()=>heading.textContent.match(/\b(\d{3})\b/)?.[1]||'';
 function disablePreview(){
  for(const button of grid.querySelectorAll('button.seat')){
   button.disabled=true;
   button.classList.remove('selected');
   button.title='Ticket sales disabled';
  }
 }
 function show(section,seats){
  const rows=new Map();
  for(const seat of seats){
   const row=String(seat.row);
   if(!rows.has(row))rows.set(row,[]);
   rows.get(row).push(seat);
  }
  const fragment=document.createDocumentFragment();
  for(const [row,items] of rows){
   const line=document.createElement('div');line.className='rowline';
   const name=document.createElement('span');name.className='rowname';name.textContent=row;line.append(name);
   const wrap=document.createElement('div');wrap.className='seats';
   for(const seat of items.sort((a,b)=>Number(b.seat_number)-Number(a.seat_number))){
    const button=document.createElement('button');button.type='button';button.className='seat';
    button.textContent=String(seat.seat_number);button.disabled=true;
    button.classList.add(seat.status==='SOLD'?'sold':'held');
    button.title=`Section ${section}, Row ${row}, Seat ${seat.seat_number}: ${labels[seat.status]||'Unavailable'}`;
    button.setAttribute('aria-label',button.title);wrap.append(button);
   }
   line.append(wrap);fragment.append(line);
  }
  rendering=true;grid.replaceChildren(fragment);rendering=false;
  notice.textContent=`Live inventory: Section ${section} · ${seats.length} seats · ${seats.filter(s=>s.status==='SOLD').length} sold. Ticket sales remain disabled.`;
 }
 async function refresh(){
  const section=sectionFromHeading();if(!section)return;
  const id=++generation;active=section;
  controller?.abort();controller=new AbortController();
  rendering=true;disablePreview();grid.replaceChildren();rendering=false;
  notice.textContent=`Loading live inventory for Section ${section}…`;
  try{
   const response=await fetch(`/api/seats/section/${section}`,{cache:'no-store',signal:controller.signal});
   if(!response.ok)throw Error(`HTTP ${response.status}`);
   const data=await response.json();
   if(id!==generation||active!==section)return;
   if(data.section!==section||data.checkout_enabled!==false||!Array.isArray(data.seats))throw Error('Invalid inventory response');
   const seen=new Set();
   for(const seat of data.seats){
    if(!/^WM-ST-\d{3}-[A-Z][A-Z0-9]{0,3}-\d{2,3}$/.test(seat.sku)||seen.has(seat.sku)||!seat.sku.startsWith(`WM-ST-${section}-`)||!['SOLD','UNRELEASED','BLOCKED','HELD','AVAILABLE'].includes(seat.status))throw Error('Invalid seat data');
    seen.add(seat.sku);
   }
   show(section,data.seats);
  }catch(error){
   if(id!==generation)return;
   rendering=true;grid.replaceChildren();rendering=false;
   notice.textContent='Live inventory is unavailable. All seats remain unavailable for purchase.';
  }
 }
 new MutationObserver(()=>{
  const section=sectionFromHeading();
  if(section&&section!==active)refresh();
 }).observe(heading,{childList:true,subtree:true,characterData:true});
 // The underlying planning UI may rerender the grid without changing the section.
 // Fail closed immediately and refresh the authoritative inventory in that case.
 let scheduled=false;
 new MutationObserver(mutations=>{
  if(rendering||!mutations.some(m=>m.addedNodes.length||m.removedNodes.length))return;
  const buttons=grid.querySelectorAll('button.seat');
  if(!buttons.length)return;
  const unguarded=[...buttons].some(b=>!b.disabled||!b.hasAttribute('aria-label'));
  if(!unguarded)return; // Our live buttons already have the guard.
  disablePreview();
  if(!scheduled){scheduled=true;queueMicrotask(()=>{scheduled=false;refresh();});}
 }).observe(grid,{childList:true,subtree:true});
 refresh();window.addEventListener('focus',refresh);
})();
