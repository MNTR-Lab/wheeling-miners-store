/** V75: offline review-only Shopify option mutation plan. Never sends requests. */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const gid=/^gid:\/\/shopify\/Product\/\d+$/;
const optionGid=/^gid:\/\/shopify\/ProductOption\/\d+$/;
const placeholder=/^WM-ST-SEC-(\d{3})$/;
export const INSPECT=`query SeatOptionInspection($id:ID!){product(id:$id){id title status options{id name values} variants(first:5){pageInfo{hasNextPage endCursor} nodes{id sku inventoryQuantity price}}}}`;
export const RENAME=`mutation RenameSeasonRow($productId:ID!,$option:OptionUpdateInput!){productOptionUpdate(productId:$productId,option:$option,variantStrategy:LEAVE_AS_IS){product{id options{id name values}} userErrors{field message}}}`;
export const ADD=`mutation AddSeasonSeat($productId:ID!,$options:[OptionCreateInput!]!){productOptionsCreate(productId:$productId,options:$options,variantStrategy:LEAVE_AS_IS){product{id options{id name values}} userErrors{field message}}}`;
function check(ok,msg){if(!ok)throw Error(msg);}
export function buildOptionOperations(product){
 check(product&&gid.test(product.id),'Invalid product ID');
 check(product.status==='DRAFT','Product must be draft');
 const conn=product.variants;
 check(conn&&conn.pageInfo?.hasNextPage===false&&Array.isArray(conn.nodes)&&conn.nodes.length===1,'Expected one complete placeholder variant');
 const v=conn.nodes[0],m=placeholder.exec(v.sku||'');
 check(m,'Unexpected placeholder SKU');
 check(v.inventoryQuantity===0,'Placeholder inventory must be zero');
 check(Array.isArray(product.options),'Missing options');
 const ops=product.options;
 if(ops.length===2&&ops[0].name==='Row'&&ops[1].name==='Seat')return {section:m[1],product_id:product.id,mode:'REVIEW_ONLY',ready:true,already_configured:true,operations:[],sales_enabled:false};
 check(ops.length===1&&ops[0].name==='Title'&&optionGid.test(ops[0].id),'Unexpected product options');
 check(ops[0].values.length===1&&ops[0].values[0]===`Section ${m[1]}`,'Unexpected Title option value');
 const operations=[
  {step:1,name:'Rename Title option to Row',request:{query:RENAME,variables:{productId:product.id,option:{id:ops[0].id,name:'Row'}}},verify:'Re-query product; Row option exists; original placeholder SKU and zero inventory unchanged; DRAFT'},
  {step:2,name:'Add Seat option',request:{query:ADD,variables:{productId:product.id,options:[{name:'Seat',values:[{name:'PENDING'}]}]}},verify:'Re-query product; options are Row and Seat; placeholder SKU and zero inventory unchanged; DRAFT'}
 ];
 return {section:m[1],product_id:product.id,mode:'REVIEW_ONLY',ready:true,already_configured:false,shopify_writes:0,sales_enabled:false,operations,warnings:['Do not run automatically. Shopify may reject renaming a default option; stop on any error.','The existing placeholder variant is not a ticket and must never be published or given stock.','The placeholder Row value will remain Section ### until replaced or removed after seat variants exist.','Each operation requires independent live re-query and review before proceeding.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.length!==4)throw Error('Usage: node tools/build-season-option-operations.mjs product.json output.json');const p=JSON.parse(readFileSync(process.argv[2],'utf8'));const result=buildOptionOperations(p?.data?.product??p?.product??p);writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({section:result.section,steps:result.operations.length,executed:false}));}catch(e){console.error(e.message);process.exitCode=1;}}
