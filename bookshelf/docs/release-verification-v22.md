# version22 検索結果のスクロール修正（2026-09-30 JST）

利用者画像で、左欄の本文検索結果が数十pxへ縮まり見えない症状を確認。CSSのflex:1/min-height:0で結果だけが残り高に圧縮され、sidebarと結果の二重スクロールになっていた。

結果はflex:0 0 auto/overflow:visibleに変更。左欄の子要素を縮めずsidebar全体を縦スクロールさせる。見出し余白を縮め、結果カードの文字を15px相当・行間1.7へ変更、タイトル折返しと結果regionラベル・sidebarキーボードフォーカスを追加。styles.css?v=22で既存キャッシュを更新。公開版表示のみhealth22へ変更。PDF登録/閲覧/検索処理・データ・本番3フラグは変更なし。DB migrationなし。

- branch: feature/digital-bookshelves / PR#1 Draft維持
- code: 9001c9318222a852412ca86a244d901976bc37cc
- Sites source: 9e7e66478dd21b644944e4867909810da9356fb9
- 公開: version22 / appgdep_6abcf30550908191bd72b0e0a72a9f61 succeeded / 同じURL維持
- CI: https://github.com/yutaro1016-ops/PDF-/actions/runs/36708901369 / run126 / verify109865699349 全step成功。既存回帰・型・ビルドを確認。
- ローカルbuildとgit diff --check成功。利用者画像の症状とコード原因を確認。
- 実ブラウザーでのスクロール/200%拡大/スマホ再確認は未実施。Sites managed-linux指定control-browser未提供のため別経路で代用しない（references/preview/managed-linux.md: "If it is unavailable, do not improvise another browser-control path.")。公開成功やCSS配信成功をUI確認と区別する。

利用者の次の操作：Ctrl+Shift+Rで再読み込み→左欄で本文検索→左欄上のホイール/右端スクロールバーで最後の結果まで移動。まだ欠ける場合はブラウザー倍率・画面サイズ・更新後画像を提出。実機受入とバックアップ等のversion21販売保留条件は継続。

公開後HTTP200・ok=true・version22、および/styles.css?v=22に新しいスクロール指定が含まれることを確認。
