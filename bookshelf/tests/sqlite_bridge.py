"""Small actual SQLite adapter for server-route integration tests; no user data."""
import sys,json,sqlite3,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
db.execute('PRAGMA foreign_keys=ON')
for migration in sorted((root/'drizzle').glob('*.sql')):
    db.executescript(migration.read_text())
for line in sys.stdin:
    request=json.loads(line)
    try:
        results=[]
        with db:
            for statement in request['statements']:
                cursor=db.execute(statement['sql'],statement.get('args',[]))
                rows=[dict(row) for row in cursor.fetchall()]
                results.append({'results':rows,'meta':{'changes':max(cursor.rowcount,0)}})
        print(json.dumps({'id':request['id'],'results':results}),flush=True)
    except Exception as error:
        print(json.dumps({'id':request['id'],'error':str(error)}),flush=True)
