/** Reusable D1 repository for migration staging. Not installed in production.
 * db/proofVerifier/ledgerVerifier and context must be server-owned trusted dependencies.
 * Formal proof collection and JWT/session verification are external prerequisites.
 */
export const SCHEMA=[
 "CREATE TABLE migration_owners(owner TEXT PRIMARY KEY,status TEXT NOT NULL CHECK(status IN ('active','blocked')))",
 "CREATE TABLE migration_identity_map(issuer TEXT NOT NULL,subject TEXT NOT NULL,owner TEXT NOT NULL UNIQUE,proof_ref TEXT NOT NULL,approval_ref TEXT NOT NULL,PRIMARY KEY(issuer,subject))",
 "CREATE TABLE migration_tombstones(owner TEXT PRIMARY KEY,sequence INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('deleting','deleted')))",
 "CREATE TABLE migration_candidates(token TEXT PRIMARY KEY,owner TEXT NOT NULL,pdf TEXT NOT NULL,kind TEXT NOT NULL,object_key TEXT NOT NULL,state TEXT NOT NULL,upload_id TEXT)",
 "CREATE TABLE migration_objects(owner TEXT NOT NULL,pdf TEXT NOT NULL,kind TEXT NOT NULL,token TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('writing','uncertain','idle')),visible_key TEXT,PRIMARY KEY(owner,pdf,kind))"
];
const OWNER=/^[A-Za-z0-9_-]{1,200}$/,PDF=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function identity(context,pdf,kind){if(!context||typeof context.ownerId!=='string'||!OWNER.test(context.ownerId)||!PDF.test(pdf)||!['pdf','thumbnail','cover'].includes(kind))throw Error('Unsafe object identity');return context.ownerId;}
export function createOwnedStore({db,proofVerifier,ledgerVerifier}){
 if(!db?.prepare||typeof proofVerifier!=='function'||typeof ledgerVerifier!=='function')throw Error('Trusted store dependencies required');
 const sql=(text,...args)=>db.prepare(text).bind(...args);
 const active="EXISTS(SELECT 1 FROM migration_owners WHERE owner=? AND status='active') AND NOT EXISTS(SELECT 1 FROM migration_tombstones WHERE owner=?)";
 return {
  async provisionOwner(owner){
   if(typeof owner!=='string'||!OWNER.test(owner))throw Error('Unsafe owner');
   await sql("INSERT OR IGNORE INTO migration_owners SELECT ?,'active' WHERE NOT EXISTS(SELECT 1 FROM migration_tombstones WHERE owner=?)",owner,owner).run();
   if(!await sql("SELECT owner FROM migration_owners WHERE owner=? AND status='active' AND NOT EXISTS(SELECT 1 FROM migration_tombstones WHERE owner=?)",owner,owner).first())throw Error('Owner blocked');
  },
  async approveMapping(claim){
   const proof=await proofVerifier(claim);
   if(!proof||proof.issuer!==claim.issuer||proof.subject!==claim.subject||proof.ownerId!==claim.originalUserId||proof.proofReference!==claim.proofReference||!proof.approvalReference||!OWNER.test(proof.ownerId)||!proof.issuer||!proof.subject||!proof.proofReference)throw Error('Ownership proof refused');
   const prior=await sql('SELECT * FROM migration_identity_map WHERE issuer=? AND subject=?',proof.issuer,proof.subject).first();
   if(prior){if(prior.owner!==proof.ownerId||prior.proof_ref!==proof.proofReference||prior.approval_ref!==proof.approvalReference)throw Error('Mapping conflict');if(!await this.mapping(proof.issuer,proof.subject))throw Error('Owner blocked');return;}
   const r=await sql('INSERT INTO migration_identity_map SELECT ?,?,?,?,? WHERE '+active,proof.issuer,proof.subject,proof.ownerId,proof.proofReference,proof.approvalReference,proof.ownerId,proof.ownerId).run();
   if(r.meta.changes!==1)throw Error('Owner blocked');
  },
  async mapping(issuer,subject){
   const row=await sql("SELECT m.* FROM migration_identity_map m JOIN migration_owners o ON o.owner=m.owner WHERE issuer=? AND subject=? AND o.status='active' AND NOT EXISTS(SELECT 1 FROM migration_tombstones t WHERE t.owner=m.owner)",issuer,subject).first();
   return row?{issuer:row.issuer,subject:row.subject,originalUserId:row.owner,status:'approved',proofReference:row.proof_ref}:null;
  },
  async blocked(owner){return !await sql("SELECT owner FROM migration_owners WHERE owner=? AND status='active' AND NOT EXISTS(SELECT 1 FROM migration_tombstones WHERE owner=?)",owner,owner).first();},
  async applyTombstone(entry){
   const proof=await ledgerVerifier(entry);
   if(!proof||proof.ownerId!==entry.ownerId||proof.sequence!==entry.sequence||proof.state!==entry.state||!OWNER.test(entry.ownerId)||!Number.isSafeInteger(entry.sequence)||entry.sequence<1||!['deleting','deleted'].includes(entry.state))throw Error('Trusted deletion ledger required');
   // Reject same-revision contradictory evidence; older entries never roll state back.
   const old=await sql('SELECT sequence,state FROM migration_tombstones WHERE owner=?',entry.ownerId).first();
   if(old?.sequence===entry.sequence&&old.state!==entry.state)throw Error('Ledger conflict');
   await db.batch([
    sql('INSERT INTO migration_tombstones VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET sequence=excluded.sequence,state=CASE WHEN excluded.sequence=migration_tombstones.sequence AND excluded.state<>migration_tombstones.state THEN NULL ELSE excluded.state END WHERE excluded.sequence>=migration_tombstones.sequence',entry.ownerId,entry.sequence,entry.state),
    sql("INSERT INTO migration_owners VALUES(?,'blocked') ON CONFLICT(owner) DO UPDATE SET status='blocked'",entry.ownerId),
    sql('UPDATE migration_objects SET visible_key=NULL WHERE owner=?',entry.ownerId)
   ]);
  },
  async begin(context,pdf,kind='pdf'){
   const owner=identity(context,pdf,kind),token=crypto.randomUUID();
   const statement=sql("INSERT INTO migration_objects SELECT ?,?,?,?,'writing',NULL WHERE "+active+" AND NOT EXISTS(SELECT 1 FROM migration_candidates WHERE owner=? AND state='uncertain') ON CONFLICT(owner,pdf,kind) DO UPDATE SET token=excluded.token,state='writing'",owner,pdf,kind,token,owner,owner,owner);
   const key=owner+'/'+pdf+'/generations/'+token+'.'+kind;
   const result=await db.batch([statement,sql("INSERT INTO migration_candidates SELECT ?,?,?,?,?,'writing',NULL WHERE EXISTS(SELECT 1 FROM migration_objects WHERE owner=? AND pdf=? AND kind=? AND token=?)",token,owner,pdf,kind,key,owner,pdf,kind,token)]);
   if(result[0].meta.changes!==1)throw Error('Owner blocked or storage result unknown');
   return Object.freeze({ownerId:owner,pdfId:pdf,kind,token,key});
  },
  async recordMultipart(operation,uploadId){
   if(typeof uploadId!=='string'||!uploadId||uploadId.length>2048)throw Error('Invalid multipart upload identity');
   const r=await sql('UPDATE migration_candidates SET upload_id=? WHERE token=? AND owner=? AND pdf=? AND kind=? AND (upload_id IS NULL OR upload_id=?)',uploadId,operation.token,operation.ownerId,operation.pdfId,operation.kind,uploadId).run();
   if(r.meta.changes!==1)throw Error('Multipart checkpoint mismatch');
  },
  async writable(operation,uploadId){
   return !!await sql("SELECT c.token FROM migration_candidates c JOIN migration_objects o ON o.owner=c.owner AND o.pdf=c.pdf AND o.kind=c.kind WHERE c.token=? AND c.owner=? AND c.object_key=? AND c.upload_id=? AND c.state='writing' AND o.token=c.token AND o.state='writing' AND "+active+" AND NOT EXISTS(SELECT 1 FROM migration_candidates WHERE owner=? AND state='uncertain')",operation.token,operation.ownerId,operation.key,uploadId,operation.ownerId,operation.ownerId,operation.ownerId).first();
  },
  async publish(operation){
   identity({ownerId:operation.ownerId},operation.pdfId,operation.kind);
   const expected=operation.ownerId+'/'+operation.pdfId+'/generations/'+operation.token+'.'+operation.kind;
   if(operation.key!==expected)throw Error('Candidate key mismatch');
   const statement=sql("UPDATE migration_objects SET visible_key=?,state='idle' WHERE owner=? AND pdf=? AND kind=? AND token=? AND state='writing' AND "+active+" AND NOT EXISTS(SELECT 1 FROM migration_candidates WHERE owner=? AND state='uncertain')",operation.key,operation.ownerId,operation.pdfId,operation.kind,operation.token,operation.ownerId,operation.ownerId,operation.ownerId);
   const result=await db.batch([statement,sql("UPDATE migration_candidates SET state='published' WHERE token=? AND EXISTS(SELECT 1 FROM migration_objects WHERE owner=? AND pdf=? AND kind=? AND visible_key=?)",operation.token,operation.ownerId,operation.pdfId,operation.kind,operation.key)]);
   return result[0].meta.changes===1;
  },
  async uncertain(operation){await db.batch([sql("UPDATE migration_objects SET state='uncertain' WHERE owner=? AND pdf=? AND kind=? AND token=?",operation.ownerId,operation.pdfId,operation.kind,operation.token),sql("UPDATE migration_candidates SET state='uncertain' WHERE token=? AND owner=?",operation.token,operation.ownerId)]);},
  async visible(context,pdf,kind='pdf'){
   const owner=identity(context,pdf,kind);
   return (await sql('SELECT visible_key FROM migration_objects WHERE owner=? AND pdf=? AND kind=? AND '+active,owner,pdf,kind,owner,owner).first())?.visible_key??null;
  }
 };
}
export function createImmutableStorage({bucket,store,expectedLengthBody}){
 if(!bucket?.put||!store||typeof expectedLengthBody!=='function')throw Error('Trusted storage dependencies required');
 return {
  async put(context,pdf,body,length,kind='pdf'){
   if(!Number.isSafeInteger(length)||length<1||length>1024*1024*1024||!body)throw Error('Invalid body length');
   const operation=await store.begin(context,pdf,kind);
   try{
    await bucket.put(operation.key,expectedLengthBody(body,length));
    return {published:await store.publish(operation),operation};
   }catch(error){await store.uncertain(operation);throw error;}
  },
  async startMultipart(context,pdf,kind='pdf'){
   const operation=await store.begin(context,pdf,kind);
   try{const upload=await bucket.createMultipartUpload(operation.key);await store.recordMultipart(operation,upload.uploadId);return {operation,uploadId:upload.uploadId};}
   catch(error){await store.uncertain(operation);throw error;}
  },
  async uploadPart(operation,uploadId,partNumber,body,length){
   if(!Number.isInteger(partNumber)||partNumber<1||partNumber>128||!Number.isInteger(length)||length<1||length>8*1024*1024||!body)throw Error('Invalid part');
   if(!await store.writable(operation,uploadId))throw Error('Operation blocked');
   try{return await bucket.resumeMultipartUpload(operation.key,uploadId).uploadPart(partNumber,expectedLengthBody(body,length));}
   catch(error){await store.uncertain(operation);throw error;}
  },
  async completeMultipart(operation,uploadId,parts){
   if(!Array.isArray(parts)||!parts.length||parts.length>128||parts.some((part,index)=>part.partNumber!==index+1||typeof part.etag!=='string'||!part.etag))throw Error('Invalid completed parts');
   if(!await store.writable(operation,uploadId))throw Error('Operation blocked');
   try{await bucket.resumeMultipartUpload(operation.key,uploadId).complete(parts);return {published:await store.publish(operation),operation};}
   catch(error){await store.uncertain(operation);throw error;}
  },
  async get(context,pdf,options={},kind='pdf'){
   const key=await store.visible(context,pdf,kind);if(!key)return null;const object=await bucket.get(key,options);if(await store.visible(context,pdf,kind)!==key){await object?.body?.cancel();return null;}return object;
  }
 };
}
