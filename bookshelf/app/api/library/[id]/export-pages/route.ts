import {currentUser,database,failure,ownedBook,serverError} from '../../shared';
export const runtime='edge';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){const user=await currentUser();if(!user)return failure('ログインが必要です。',401);
 try{const {id}=await context.params;if(!await ownedBook(id,user))return failure('資料が見つかりません。',404);const cursor=Number(new URL(request.url).searchParams.get('after')??0);if(!Number.isSafeInteger(cursor)||cursor<0)return failure('位置が不正です。');const {results}=await database().prepare('SELECT page_number AS number,body,normalized FROM pages WHERE book_id=? AND page_number>? ORDER BY page_number LIMIT 26').bind(id,cursor).all<{number:number,body:string,normalized:string}>();const pages=results.slice(0,25);return Response.json({pdfId:id,pages,hasMore:results.length>25,next:pages.at(-1)?.number??cursor},{headers:{'Cache-Control':'private, no-store'}});}catch(error){return serverError(error);}
}
