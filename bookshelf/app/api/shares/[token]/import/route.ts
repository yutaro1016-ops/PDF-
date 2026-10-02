import {ACTIVE_ACCOUNT_SQL,USED_BYTES_SQL,capacityEnforced,PROPOSED_BYTES} from '../../../account/policy';
import {currentUser,database,failure,sameOrigin,serverError} from '../../../library/shared';
import {activeShare,sharedBooks,jobView} from '../../shared';
export const runtime='edge';
export async function POST(request:Request,context:{params:Promise<{token:string}>}){
  const user=await currentUser();if(!user)return failure('ログインが必要です。',401);if(!sameOrigin(request))return failure('許可されていません。',403);
  try{
    const {token}=await context.params,share=await activeShare(token);if(!share)return failure('共有リンクが無効です。',404);
    const payload=await request.json() as {requestId:string,ids:string[],mode:string,shelfId?:string|null,shelfName?:string};
    if(!/^[a-f0-9-]{36}$/i.test(payload.requestId??''))return failure('取り込み操作を確認できません。');
    const db=database(),existing=await db.prepare('SELECT user_id,share_id FROM import_jobs WHERE id=?').bind(payload.requestId).first<{user_id:string,share_id:string}>();
    if(existing){if(existing.user_id!==user||existing.share_id!==share.id)return failure('許可されていません。',403);return Response.json({job:await jobView(payload.requestId,user)});}
    const active=await db.prepare("SELECT id FROM import_jobs WHERE user_id=? AND share_id=? AND status='pending' LIMIT 1").bind(user,share.id).first<{id:string}>();
    if(active)return Response.json({job:await jobView(active.id,user)});
    if(!Array.isArray(payload.ids)||payload.ids.length>1000)return failure('取り込む本を選択してください。');
    const available=await sharedBooks(share),ids=new Set(payload.ids),items=available.filter(b=>ids.has(b.id));
    if(items.length!==ids.size)return failure('共有元で削除された本があります。内容を再確認してください。');
    if(!items.length && !(share.kind==='shelf'&&payload.mode==='new'))return failure('取り込む本を選択してください。');
    const {results:previous}=await db.prepare("SELECT i.source_id FROM import_items i JOIN import_jobs j ON j.id=i.job_id JOIN books b ON b.id=i.target_id AND b.user_id=j.user_id WHERE j.user_id=? AND j.share_id=? AND i.status='done'").bind(user,share.id).all<{source_id:string}>();
    const copied=new Set(previous.map(row=>row.source_id)),fresh=items.filter(b=>!copied.has(b.id));
    if(items.length && !fresh.length)return failure('選択した本はすでに自分の本棚へ追加済みです。');
    let shelfId=payload.shelfId??null;const now=new Date().toISOString(),statements:D1PreparedStatement[]=[];
    if(payload.mode==='new'){
      const name=String(payload.shelfName||share.name).trim().slice(0,80);if(!name)return failure('本棚名を入力してください。');
      shelfId=crypto.randomUUID();const shelf=share.shelf_json?JSON.parse(share.shelf_json):{};
      statements.push(db.prepare('INSERT INTO shelves(id,user_id,name,shelf_order,color,board_color,text_color,design,created_at,updated_at) SELECT ?,?,?,(SELECT COALESCE(MAX(shelf_order),0)+1 FROM shelves WHERE user_id=?),?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM import_jobs WHERE id=? AND user_id=?)').bind(shelfId,user,name,user,shelf.color||'#e9edf0',shelf.board_color||'#a8b7bd',shelf.text_color||'#172d43',shelf.design||'simple',now,now,payload.requestId,user));
    }else if(payload.mode==='existing'){
      if(shelfId&&!await db.prepare('SELECT id FROM shelves WHERE id=? AND user_id=?').bind(shelfId,user).first())return failure('追加先の本棚が見つかりません。',404);
    }else return failure('追加先を選択してください。');
    const bytes=fresh.reduce((sum,book)=>sum+Number(book.file_size),0);
    statements.unshift(db.prepare(`INSERT INTO import_jobs(id,user_id,share_id,shelf_id,status,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE ${ACTIVE_ACCOUNT_SQL} AND (?=0 OR (${USED_BYTES_SQL})+?<=?)`).bind(payload.requestId,user,share.id,shelfId,fresh.length?'pending':'done',now,now,user,capacityEnforced()?1:0,user,user,bytes,PROPOSED_BYTES));
    // JSON_each keeps parameter count bounded even with many books.
    const rows=fresh.map((book,position)=>({sourceId:book.id,targetId:crypto.randomUUID(),position}));
    statements.push(db.prepare("INSERT INTO import_items(job_id,source_id,target_id,position,metadata) SELECT ?,json_extract(j.value,'$.sourceId'),json_extract(j.value,'$.targetId'),json_extract(j.value,'$.position'),json_object('title',b.title,'file_name',b.file_name,'file_size',b.file_size,'page_count',b.page_count,'book_color',b.book_color,'text_color',b.text_color,'book_design',b.book_design,'book_icon',b.book_icon,'cover_image',b.cover_image,'tags',b.tags) FROM json_each(?) j JOIN books b ON b.id=json_extract(j.value,'$.sourceId') WHERE b.user_id=? AND b.status='ready' AND EXISTS(SELECT 1 FROM import_jobs WHERE id=? AND user_id=?)").bind(payload.requestId,JSON.stringify(rows),share.user_id,payload.requestId,user));
    await db.batch(statements);const job=await jobView(payload.requestId,user);if(!job)return failure('容量上限または退会処理により取り込めません。',409);return Response.json({job},{status:201});
  }catch(error){return serverError(error);}
}
