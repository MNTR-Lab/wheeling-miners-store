/* TEST staging seat overlay: live D1 section inventory is authoritative.
 * This script NEVER allows selection, holding, checkout, or ticket sales.
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
 let active='',generation=0,controller=null;
 const statusLabel={SOLD:'Sold',UNRELEASED:'Not released for sale',BLOCKED:'Blocked',HELD:'Held',AVAILABLE:'Sales disabled',UNAVAILABLE:'Unavailable'};
 function disableAll(){for(const button of grid.querySelectorAll('button.seat')){button.disabled=true;button.classList.remove('selected');button.title='Sales disabled';}}
 function show(section,seats){
  const rows=new Map();
  for(const seat of seats){const row=String(seat.row);if(!rows.has(row))rows.set(row,[]);rows.get(row).push(seat);}
  const fragment=document.createDocumentFragment();
  for(const [row,seatsInRow] of rows){
   const line=document.createElement('div');line.className='rowline';
   const label=document.createElement('span');label.className='rowname';label.textContent=row;line.append(label);
   const wrap=document.createElement('div');wrap.className='seats';
   for(const seat of seatsInRow.sort((a,b)=>Number(b.seat_number)-Number(a.seat_number))){
    const button=document.createElement('button');button.type='button';button.className='seat';
    button.textContent=String(seat.seat_number);button.disabled=true;
    if(seat.status==='SOLD')button.classList.add('sold');else button.classList.add('held');
    const reason=statusLabel[seat.status]||'Unavailable';
    button.title=`Section ${section}, Row ${row}, Seat ${seat.seat_number}: ${reason}`;
    button.setAttribute('aria-label',button.title);wrap.append(button);
   }
   line.append(wrap);fragment.append(line);
  }
  grid.replaceChildren(fragment);
  notice.textContent=`Live inventory: Section ${section} · ${seats.length} seats · ${seats.filter(s=>s.status==='SOLD').length} sold. Ticket sales remain disabled.`;
 }
 async function refresh(){
  const section=heading.textContent.match(/\b(\d{3})\b/)?.[1];
  if(!section)return;
  const id=++generation;active=section;
  controller?.abort();controller=new AbortController();
  disableAll();grid.replaceChildren();notice.textContent=`Loading live inventory for Section ${section}…`;
  try{
   const response=await fetch(`/api/seats/section/${section}`,{cache:'no-store',signal:controller.signal});
   if(!response.ok)throw Error(`HTTP ${response.status}`);
   const data=await response.json();
   if(id!==generation||active!==section)return;
   if(data.section!==section||data.checkout_enabled!==false||!Array.isArray(data.seats))throw Error('Invalid inventory response');
   const seen=new Set();
   for(const seat of data.seats){
    if(!/^WM-ST-\d{3}-[A-Z][A-Z0-9]{0,3}-\d{2,3}$/.test(seat.sku)||seen.has(seat.sku)||!seat.sku.startsWith(`WM-ST-${section}-`))throw Error('Invalid or duplicate seat');
    seen.add(seat.sku);
   }
   show(section,data.seats);
  }catch(error){
   if(id!==generation)return;
   grid.replaceChildren();notice.textContent='Live inventory is unavailable. All seats remain unavailable for purchase.';
  }
 }
 new MutationObserver(()=>{
  const section=heading.textContent.match(/\b(\d{3})\b/)?.[1];
  if(section&&section!==active)refresh();
 }).observe(heading,{childList:true,subtree:true,characterData:true});
 refresh();window.addEventListener('focus',refresh);
})();
