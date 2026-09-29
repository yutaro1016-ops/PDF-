# PDF本棚

公開アプリ: https://pdf-page-finder.yutaro1016.chatgpt.site/shelf

このディレクトリは公開 Sites プロジェクトの主要ソースの GitHub ミラーです。公開版 12 の Sites ソースコミットは `4224dcab8d4bfd93251478452611006fd099123b`、Sites プロジェクト ID は `appgprj_6abb0a1c108c8191a976513dd82174aa` です。GitHub の push だけでは公開版は変わりません。公開時は Sites のソースリポジトリへ同じ変更を反映し、保存済み版をデプロイしてください。

- PDF 本体は利用者ごとの R2、メタデータとページ本文は D1 に保存します。GitHub へ登録済み PDF や利用者データは置きません。
- PDF ID と R2 キーは変更せず、追加の D1 移行で本棚と装飾情報を管理します。所属なしの既存 PDF は未分類に表示します。
- 1GB 以下の PDF を扱い、8MB 超は分割登録します。PDF.js は必要な範囲を取得し、本文索引はページ単位で保存します。
- 本棚の作成・設定・削除、PDF の移動・順序・色・タグ・表紙設定、全冊または複数冊での本文検索を備えます。画像 PDF の OCR はありません。
- `python3 tests/migration_test.py` と `node --check public/app.js` が GitHub Actions でも実行されます。

Sites のソースリポジトリが完全なビルドソースです。この GitHub ミラーには PDF.js 配布物や一部のビルド補助ファイルが含まれていないため、単独でのデプロイにはそれらの同期が必要です。公開環境への自動デプロイは設定されていません。
