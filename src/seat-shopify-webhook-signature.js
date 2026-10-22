/** V94: strict byte-exact Shopify HMAC verification; no sales or fulfillment authority. */
const BASE64_SHA256=/^[A-Za-z0-9+/]{43}=$/;
export async function validShopifySignature(raw,signature,secret){
 if(!(raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)))return false;
 if(typeof secret!=='string'||secret.length===0)return false;
 if(typeof signature!=='string'||!BASE64_SHA256.test(signature))return false;
 const bytes=raw instanceof ArrayBuffer?new Uint8Array(raw):new Uint8Array(raw.buffer,raw.byteOffset,raw.byteLength);
 try{
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const digest=new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes));
  const expected=btoa(String.fromCharCode(...digest));
  let difference=0;
  for(let i=0;i<expected.length;i++)difference|=expected.charCodeAt(i)^signature.charCodeAt(i);
  return difference===0;
 }catch{return false;}
}
