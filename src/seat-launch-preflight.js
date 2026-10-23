/** V124: fail-closed, read-only inventory launch preflight.
 * Does not grant authorization or enable sales.
 */
const fail=code=>{throw Error(code)};
const COUNT=3737,SECTIONS=63;
const QUERY=`SELECT COUNT(*) AS total,COUNT(DISTINCT section) AS sections,
 SUM(CASE WHEN status='UNRELEASED' THEN 1 ELSE 0 END) AS unreleased,
 SUM(CASE WHEN status='AVAILABLE' THEN 1 ELSE 0 END) AS available,
 SUM(CASE WHEN status='HELD' THEN 1 ELSE 0 END) AS held,
 SUM(CASE WHEN status='SOLD' THEN 1 ELSE 0 END) AS sold,
 SUM(CASE WHEN status='BLOCKED' THEN 1 ELSE 0 END) AS blocked,
 SUM(CASE WHEN shopify_variant_id IS NOT NULL AND TRIM(shopify_variant_id)<>'' THEN 1 ELSE 0 END) AS mapped
 FROM seats`;
const DUPLICATES=`SELECT COUNT(*) AS count FROM
 (SELECT shopify_variant_id FROM seats WHERE shopify_variant_id IS NOT NULL
 AND TRIM(shopify_variant_id)<>'' GROUP BY shopify_variant_id HAVING COUNT(*)>1)`;
const CONFLICTS=`SELECT COUNT(*) AS count FROM seats WHERE
 (status='UNRELEASED' AND (hold_id IS NOT NULL OR shopify_order_id IS NOT NULL))
 OR (status='SOLD' AND shopify_order_id IS NULL)
 OR (status='HELD' AND (hold_id IS NULL OR hold_expires_at IS NULL))`;
function integer(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<0)fail('INVALID_INVENTORY_RESULT');return n}
export function evaluateLaunchInventory(summary,duplicates,conflicts){
 if(!summary||!duplicates||!conflicts)fail('INVALID_INVENTORY_RESULT');
 const values={};
 for(const key of ['total','sections','unreleased','available','held','sold','blocked','mapped'])values[key]=integer(summary[key]);
 const duplicateCount=integer(duplicates.count),conflictCount=integer(conflicts.count);
 const issues=[];
 if(values.total!==COUNT)issues.push('SEAT_COUNT_MISMATCH');
 if(values.sections!==SECTIONS)issues.push('SECTION_COUNT_MISMATCH');
 if(values.mapped!==values.total)issues.push('UNMAPPED_SEATS');
 if(duplicateCount)issues.push('DUPLICATE_VARIANTS');
 if(conflictCount)issues.push('INCONSISTENT_SEAT_STATE');
 if(values.unreleased+values.available+values.held+values.sold+values.blocked!==values.total)issues.push('STATUS_TOTAL_MISMATCH');
 if(values.available||values.held||values.sold)issues.push('INVENTORY_NOT_FULLY_UNRELEASED');
 return {mode:'READ_ONLY_PREFLIGHT',inventory:values,duplicateVariants:duplicateCount,
  conflictingSeatStates:conflictCount,checksPassed:issues.length===0,issues,
  salesEnabled:false,checkoutEnabled:false,authorizationGranted:false,
  readyForSales:false,databaseMutations:0,shopifyMutations:0};
}
export async function inspectLaunchInventory(db){
 if(!db?.prepare)fail('DATABASE_UNAVAILABLE');
 const first=async sql=>{const result=await db.prepare(sql).first();if(!result)fail('INVALID_INVENTORY_RESULT');return result};
 const summary=await first(QUERY),duplicates=await first(DUPLICATES),conflicts=await first(CONFLICTS);
 return evaluateLaunchInventory(summary,duplicates,conflicts);
}
