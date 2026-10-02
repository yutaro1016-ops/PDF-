/** Offline integration boundary. NOT wired to Sites or a production OIDC provider.
 * verifySession and loadMapping must be server-owned trusted implementations.
 * A request header or JSON 'verified' flag is never an ownership proof.
 */
export function createAccessBoundary({verifySession,loadMapping,isBlocked,issuer,audience}) {
  if(![verifySession,loadMapping,isBlocked].every(x=>typeof x==='function')||!issuer||!audience)throw Error('Trusted dependencies required');
  return async function authorize(request,{reauthenticate=false,now=Date.now()/1000}={}) {
    const p=await verifySession(request);
    if(!p||p.issuer!==issuer||p.audience!==audience||typeof p.subject!=='string'||!p.subject||!Number.isFinite(p.expiresAt)||p.expiresAt<=now)throw Error('Authentication refused');
    if(reauthenticate&&(!Number.isFinite(p.authTime)||p.authTime>now||now-p.authTime>300))throw Error('Recent reauthentication required');
    const m=await loadMapping(p.issuer,p.subject);
    if(!m||m.issuer!==p.issuer||m.subject!==p.subject||m.status!=='approved'||typeof m.proofReference!=='string'||!m.proofReference||typeof m.originalUserId!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(m.originalUserId))throw Error('Ownership mapping refused');
    if(await isBlocked(m.originalUserId))throw Error('Account blocked');
    return Object.freeze({ownerId:m.originalUserId});
  };
}
export function objectKey(context,pdfId,kind='pdf') {
  if(!context||!/^[A-Za-z0-9_-]{1,200}$/.test(context.ownerId)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(pdfId))throw Error('Unsafe object identity');
  const suffix={pdf:'.pdf',thumbnail:'.thumbnail.jpg'}[kind];
  if(!suffix)throw Error('Unsupported object kind');
  return context.ownerId+'/'+pdfId+suffix;
}
