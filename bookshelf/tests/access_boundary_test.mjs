import assert from 'node:assert/strict';
import {createAccessBoundary,objectKey} from '../migration/access-boundary.mjs';
const now=1000,request=new Request('https://example.test',{headers:{'oai-authenticated-user-id':'victim'}});
let principal=null,blocked=false,mapping={issuer:'trusted',subject:'new-id',originalUserId:'original-id',status:'approved',proofReference:'offline-proof'};
const auth=createAccessBoundary({issuer:'trusted',audience:'app',verifySession:async()=>principal,loadMapping:async()=>mapping,isBlocked:async()=>blocked});
await assert.rejects(()=>auth(request,{now}));
principal={issuer:'trusted',audience:'app',subject:'new-id',expiresAt:1100,authTime:990};
assert.equal((await auth(request,{now})).ownerId,'original-id');
for(const field of ['issuer','audience','subject','expiresAt']){const before=principal;principal={...principal,[field]:field==='expiresAt'?999:'forged'};await assert.rejects(()=>auth(request,{now}));principal=before;}
for(const patch of [{status:'pending'},{proofReference:''},{subject:'foreign'},{originalUserId:'../victim'}]){const before=mapping;mapping={...mapping,...patch};await assert.rejects(()=>auth(request,{now}));mapping=before;}
blocked=true;await assert.rejects(()=>auth(request,{now}));blocked=false;
principal.authTime=600;await assert.rejects(()=>auth(request,{now,reauthenticate:true}));principal.authTime=990;await auth(request,{now,reauthenticate:true});
assert.equal(objectKey({ownerId:'original-id'},'12345678-1234-1234-1234-123456789abc'),'original-id/12345678-1234-1234-1234-123456789abc.pdf');
assert.throws(()=>objectKey({ownerId:'../victim'},'12345678-1234-1234-1234-123456789abc'));
console.log('Offline auth boundary rejects forged headers/claims, unproved mappings, blocked accounts and stale reauthentication');
