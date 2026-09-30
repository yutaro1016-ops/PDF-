import { currentUser, database, failure, sameOrigin, serverError } from "../library/shared";

export const runtime = "edge";

async function search(request:Request, payload?:{q?:unknown,books?:unknown}) {
  const userId = await currentUser();
  if (!userId) return failure("ログインが必要です。", 401);
  const query = String(payload ? payload.q??'' : new URL(request.url).searchParams.get('q')??'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,'').slice(0,100);
  const input=payload ? payload.books??[] : new URL(request.url).searchParams.getAll('book');
  if(!Array.isArray(input)||input.length>1000||input.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id)))return failure('検索対象を確認できません。');
  const bookIds=[...new Set(input)];
  if (!query) return Response.json({results:[],truncated:false},{headers:{'Cache-Control':'private, no-store'}});
  try {
    const sql="SELECT b.id AS bookId,b.title,p.page_number AS pageNumber,p.body AS text FROM pages p JOIN books b ON b.id=p.book_id WHERE b.user_id=? AND b.status != 'importing' AND instr(p.normalized,?)>0"+(bookIds.length?' AND b.id IN (SELECT value FROM json_each(?))':'')+' ORDER BY b.created_at DESC,p.page_number LIMIT 41';
    const {results}=await database().prepare(sql).bind(userId,query,...(bookIds.length?[JSON.stringify(bookIds)]:[])).all();
    return Response.json({results:results.slice(0,40),truncated:results.length>40},{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){return serverError(error);}
}
export async function GET(request:Request){return search(request);}
export async function POST(request:Request){
 if(!sameOrigin(request))return failure('許可されていません。',403);
 try{return await search(request,await request.json());}catch(error){return serverError(error);}
}
