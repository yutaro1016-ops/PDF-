import { currentUser, database, failure, serverError } from "../library/shared";

export const runtime = "edge";

export async function GET(request: Request) {
  const userId = await currentUser();
  if (!userId) return failure("ログインが必要です。", 401);
  const query = (new URL(request.url).searchParams.get("q") || "").normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "").slice(0, 100);
  if (!query) return Response.json({ results: [], truncated: false });
  try {
    const { results } = await database().prepare(
      "SELECT b.id AS bookId, b.title, p.page_number AS pageNumber, p.body AS text FROM pages p JOIN books b ON b.id = p.book_id WHERE b.user_id = ? AND instr(p.normalized, ?) > 0 ORDER BY b.created_at DESC, p.page_number LIMIT 41"
    ).bind(userId, query).all();
    return Response.json({ results: results.slice(0, 40), truncated: results.length > 40 });
  } catch (error) { return serverError(error); }
}
