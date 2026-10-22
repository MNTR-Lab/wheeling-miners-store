/** Shared byte-exact Shopify webhook HMAC verification. */
export async function validShopifySignature(raw,signature,secret){
 if(typeof secret!=='string'||!secret||typeof signature!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(signature))return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const digest=new Uint8Array(await crypto.subtle.sign('HMAC',key,raw));
 const expected=btoa(String.fromCharCode(...digest));
 if(expected.length!==signature.length)return false;
 let difference=0;for(let i=0;i<expected.length;i++)difference|=expected.charCodeAt(i)^signature.charCodeAt(i);
 return difference===0;
}
