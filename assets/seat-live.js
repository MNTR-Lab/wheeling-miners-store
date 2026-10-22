/* V38 live read-only seat status overlay. Does not reserve or sell tickets. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const API='/api/seats/section/';
 let activeSection='',requestId=0;
 const notice=document.createElement('div');
 notice.style.cssText='margin:12px 0;padding:12px;border:1px solid #81622c;background:#292216;color:#ffe4a1;border-radius:8px;font-size:13px';
 notice.setAttribute('role','status');
 notice.textContent='Loading live seat inventory. Seat purchases remain disabled.';
 const grid=$('seatgrid');if(!grid)return;
 grid.parentElement.insertBefore(notice,grid);
 const baseHeading=$('heading');
 function markDisabled(button,reason){button.disabled=true;button.classList.remove('selected');button.classList.add('held');button.title=reason;button.setAttribute('aria-label',(button.title||'Seat')+' — '+reason);}
 async function refresh(){
  const section=(baseHeading?.textContent||'').match(/\b(\d{3})\b/)?.[1];
  if(!section)return;
  const token=++requestId;activeSection=section;
  // Fail closed while loading: no seat can be selected from stale preview data.
  grid.querySelectorAll('button.seat').forEach(b=>markDisabled(b,'Checking live inventory'));
  notice.textContent='Checking live inventory for Section '+section+'…';
  try{
   const response=await fetch(API+section,{cache:'no-store'});
   if(!response.ok)throw Error('HTTP '+response.status);
   const data=await response.json();
   if(token!==requestId||activeSection!==section)return;
   const lookup=new Map(data.seats.map(s=>[String(s.row)+'|'+String(s.seat_number),s]));
   let index=0,blocked=0;
   for(const line of grid.querySelectorAll('.rowline')){
    const row=line.querySelector('.rowname')?.textContent?.trim();
    for(const b of line.querySelectorAll('button.seat')){
     const seat=lookup.get(row+'|'+b.textContent.trim());
     index++;
     if(!seat||seat.status!=='AVAILABLE'){blocked++;markDisabled(b,!seat?'Seat not in live database':seat.status==='UNRELEASED'?'Not yet released for sale':seat.status==='SOLD'?'Sold':seat.status==='HELD'?'Temporarily held':'Unavailable');}
     else {b.disabled=false;b.classList.remove('held');}
    }
   }
   notice.textContent=`Section ${section}: ${data.seats.length} database seats · ${blocked} unavailable on this screen. Ticket checkout is not enabled.`;
  }catch(e){
   if(token!==requestId)return;
   grid.querySelectorAll('button.seat').forEach(b=>markDisabled(b,'Inventory unavailable'));
   notice.textContent='Live seat inventory could not be verified. Seat selection is disabled for safety.';
  }
 }
 const observer=new MutationObserver(()=>{const current=(baseHeading?.textContent||'').match(/\b(\d{3})\b/)?.[1];if(current&&current!==activeSection)refresh();});
 observer.observe(baseHeading||grid,{childList:true,subtree:true,characterData:true});
 const gridObserver=new MutationObserver(()=>{grid.querySelectorAll('button.seat:not(:disabled)').forEach(b=>markDisabled(b,'Ticket sales are not enabled'));});
 gridObserver.observe(grid,{childList:true,subtree:true});
 refresh();
 window.addEventListener('focus',refresh);
})();
