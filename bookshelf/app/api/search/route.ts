import { currentUser, database, failure, serverError } from "../library/shared";

export const runtime = "edge";

export async function GET(request: Request) {
  const userId = await currentUser();
  if (!userId) return failure("ログインが必要です。", 401);
  const query = (new URL(request.url).searchParams.get("q") || "").normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "").slice(0, 100);
  const bookIds = [...new Set(new URL(request.url).searchParams.getAll("book"))];
  if (bookIds.length > 100 || bookIds.some((id) => !/^[a-f0-9-]{36}$/i.test(id))) return failure("検索対象を確認できません。");
  if (!query) return Response.json({ results: [], truncated: false });
  try {
    const sql = "SELECT b.id AS bookId, b.title, p.page_number AS pageNumber, p.body AS text FROM pages p JOIN books b ON b.id = p.book_id WHERE b.user_id = ? AND b.status != 'importing' AND instr(p.normalized, ?) > 0" +
      (bookIds.length ? ` AND b.id IN (${bookIds.map(() => "?").join(",")})` : "") + " ORDER BY b.created_at DESC, p.page_number LIMIT 41";
    const statement = database().prepare(sql);
    const { results } = await statement.bind(userId, query, ...bookIds).all();
    return Response.json({ results: results.slice(0, 40), truncated: results.length > 40 });
  } catch (error) { return serverError(error); }
}
