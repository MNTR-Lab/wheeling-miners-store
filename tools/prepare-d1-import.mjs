/** Transform verified offline mapping into a D1 import script. No network or writes. */
import {readFileSync,writeFileSync} from 'node:fs';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node tools/prepare-d1-import.mjs source.sql output.sql');
const original=readFileSync(input,'utf8');
const lines=original.split(/\r?\n/);
if(lines.filter(x=>x.trim()==='BEGIN TRANSACTION;').length!==1||lines.filter(x=>x.trim()==='COMMIT;').length!==1)throw Error('TRANSACTION_ENVELOPE_MISMATCH');
const updates=lines.filter(x=>x.startsWith('UPDATE seats SET shopify_variant_id='));
const guards=lines.filter(x=>x.startsWith('INSERT INTO seat_admin_guard'));
const clears=lines.filter(x=>x.startsWith('DELETE FROM seat_admin_guard'));
if(updates.length!==3737||guards.length!==3737||clears.length!==3738)throw Error('GUARD_COUNT_MISMATCH');
const skus=new Set(),ids=new Set();
for(const s of updates){
 const m=/^UPDATE seats SET shopify_variant_id='(gid:\/\/shopify\/ProductVariant\/[1-9]\d*)',updated_at=CURRENT_TIMESTAMP WHERE sku='(WM-ST-\d{3}-[A-Z][A-Z0-9]{0,3}-\d{2,3})' AND status='UNRELEASED' AND shopify_variant_id IS NULL AND price_cents=(\d+) AND section_product_sku='WM-ST-SEC-(\d{3})';$/.exec(s);
 if(!m||m[2].slice(6,9)!==m[4]||skus.has(m[2])||ids.has(m[1]))throw Error('INVALID_UPDATE');
 skus.add(m[2]);ids.add(m[1]);
}
const sql=lines.filter(x=>x.trim()!=='BEGIN TRANSACTION;'&&x.trim()!=='COMMIT;').join('\n');
// Wrangler's D1 SQL import manages transactions; explicit BEGIN/COMMIT are not supported.
writeFileSync(output,sql,{flag:'wx',mode:0o600});
console.log(JSON.stringify({status:'PREPARED',mode:'NO_DATABASE_WRITES',seats:skus.size,variant_ids:ids.size,guards:guards.length,explicit_transactions_removed:true}));
