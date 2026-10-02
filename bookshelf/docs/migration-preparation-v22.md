# version22からの移行準備・取得範囲（2026-10-01）

> 2026-10-01 11:42 JST 訂正: 利用者から別アカウントの索引・棚・画像も「問題なし」との報告を受領済みとして扱う。追加の同じ確認依頼は撤回。利用者報告と開発者の独立試験を区別し、HTTP状態・詳細端末版等の未提出を理由に再確認を求めない。以下に残る過去の提出手順は履歴であり、今回の必要作業ではない。
## 現在地
ユーザーが提示したOpenAI Supportの回答では、SitesのD1/R2全量backup/restore、整合点、保持、RPO/RTO、独立復元の正式手順を確認できなかった。機能不存在の確定回答ではない。同じ問い合わせの再送を次の作業条件にしない。販売は保留。本番の3フラグは未設定・既定false、revision0/entries0を今回再確認。
公開version22、Sites source9e7e66478dd21b644944e4867909810da9356fb9、GitHub HEAD0505f267c4cbf0168db24a932fc0fbd628fafa53を開始基準として比較。公開アプリに変更はなく、今回の追加は独立したoffline準備ツール・試験・資料のみ。環境作成、全量取得、切替を実施していない。

## 取得範囲（コードと提供された権限から確認）
|データ|現行経路|不足・限界|
|---|---|---|
|所有PDF ID/本体|本人認証のlibrary/{id}/file、フォルダー保存|本人ready PDFだけ。本体SHA256は端末取得後に計算。全利用者/孤立objectの一覧権限なし|
|本文索引|export-index / export-pages、pages.ndjson|本人対象。文字列を保持するがページ送り中の原子的snapshotではない|
|棚/所属/タグ/順序/色/本設定|account/exportのmetadata.json|shelves/booksの列を出す。棚・本の2queryは同一snapshotの保証なし|
|カスタム表紙|metadata.jsonのcover_imageは元inline data URI。cover APIも本人対象|今回の復元ツールはinline PNG/JPEG/WebP bytesを抽出・照合。画像表示/描画の実機確認ではない|
|第1ページ表紙|first-page設定とPDF本体|生成thumbnailのR2 cacheはfolder exportに含まれない。移行先で再生成が必要、画像cache全量移行済みとしない|
|共有/取消/期限|既存share APIとDB shares/share_books|ユーザーexportには含まれない。元tokenはhash保存で元文字列を復元できると断定しない。権限/expiryを保持する全量取得が必要|
|取り込みjob/part状態|DB import_jobs/import_items、既知R2 upload ID|ユーザーexportに含まれず、R2孤立multipart列挙権限も未確認。実行途中状態の完全移行は不可と扱う|
|元利用者IDと認証|DB各owner列、Sitesが注入するtrusted user header|exportは元user_idを出さない。ChatGPT認証全利用者一覧/新認証への対応権限は未確認|
|退会/停止状態|account_lifecycle/storage_operations|ユーザーexportに含まれない。削除tombstone/uncertain barrierを欠いた復元を公開してはいけない|
|DB全行|正式Sites read_database_overview / table_rowsの提供あり。今回9表名を再確認|1call最大25行、projectionで値切詰めが起こり得る。offset paginationは更新中に重複/欠落を起こし、snapshot/export/restore権限ではない。私有行や索引本文は今回ダウンロード/コミットしていない|
|R2全量/独立復旧|正式API/管理用資格情報が現環境には提供されていない|Cloudflare S3資格情報をSites向けに作成できると推測しない。PDF/画像/孤立part全量・原本整合点・復元ポイントは未確認|

本人の書き出しを集めても、全利用者・共有・ジョブ・退会状態を網羅した本番backupとはならない。取得できない項目を空配列にして完全移行と判定しない。

## 新しいofflineツール
利用者が取得済みの完了folder backupを原本のまま読み、独立したSHA256 manifestを作る。Manifestは暗号署名ではなく、原本とは別の保護された場所へ保管する。原本とmanifestを一緒に改変された場合の真正性を保証しない。seal以前の同サイズ破損は元PDFの既知hashとの照合が必要。ツールはPDFの構文/描画やindexがPDF文字と同じかまでは検証しない。

```sh
python3 scripts/migration-bundle.py seal /absolute/private-export /absolute/private-manifest.json
python3 scripts/migration-bundle.py verify /absolute/private-export /absolute/private-manifest.json
python3 scripts/migration-bundle.py restore /absolute/private-export /absolute/private-manifest.json /absolute/new-private-stage
```

既存manifest/復元先は拒否し、原本を書換えない。復元先は従来schemaの新しいSQLite、PDF、inlineカスタム表紙bytes、照合報告のみ。ownerはrecovery-stagingで、実認証対応を一切適用しない。PDF ID/本体hash/索引内容/棚と本の各export列/画像bytesを比較。不明なmetadata列の黙示消失も拒否。失敗時は今回作った未完了stageだけを除去し、原本と既存復元先を維持する。DB/R2へのnetwork書込機能はない。
PDFhash/copyは8MiBずつ読み、PDF全体をメモリーに載せない。metadataはJSONとして、索引は1行ずつ読む。productionReadyは常にfalse、scope=single-user-export、atomic snapshot/元user ID/共有/job/退会等のomitted項目を報告。pending PDFがあるexportは、jobを失わせないため拒否する。
これは元アプリの移行検証用保存先であり、独立アプリの公開や完全移行ではない。新規のproduction保存アダプター・全量export API・認証移行は未実装。現R2/SQLiteアダプターを再利用したローカル復元から着手した。
私有出力はrepo外の暗号化ディスクに置く。現ツールは暗号化を実装しておらず、暗号化済みbackupを作成したと記載しない。GitHubにmanifest（私有IDを含む）/PDF/索引/画像/DB/認証情報を置かない。

## 段階的移行案と停止条件
1. **読取取得**: 取得権限と範囲を台帳化、個別export原本/manifestを非公開保存。取得済みPDFの元SHA256照合。不足する全利用者/共有/job/tombstone/R2全量は未取得として残す。欠落がある間は完全移行としない。
2. **更新整合**: 元環境は通常稼働のまま事前コピー。最終コピー時の全変更入口・索引書込・共有/取り込みを止める方法と旧要求終了を確定し、承認された窓で停止する。原子的取得不可なら変更journal・世代object・最終差分が必要。開始/終了metadata一致や同じ件数だけで時点整合性を保証しない。現ユーザーexportの再チェックは限定的検出でありこの代替ではない。
3. **独立復元**: 費用承認後に新DB/new private bucket、公開OFF、production資格情報を持たない専用管理権限で復元。いまは合成fixtureのローカル領域だけ。
4. **照合**: 全PDF ID/byte size/SHA256、pagesのnumber/body/normalized、棚/所属/色/タグ/順序、カスタム画像、cache、共有/期限/取消、ジョブ/停止/退会行を照合。未知object、欠落、extra rowsを解消。現在のtoolは本人export内だけを照合する。
5. **認証/アクセス**: ChatGPT利用者の所有証明と新provider issuer/subjectを、管理者承認された1対1対応表にする。新ログインの本人確認が済むまでaccess disabled。email一致だけで自動移管しない。新A/BテストでPDF/index/shelf/imageと共有許可を検証。
6. **新旧比較/受入**: PC/実タブレット/実スマホ、各検索対象、Range/分割/中断/再開/共有取消/書出し、画像満載・多数page・大容量、復元演習、障害終了/結果不明/barrier、監視の通知到達を受入。同じ合成試験だけで済ませない。
7. **承認後切替**: 不足ゼロ・費用/URL影響・停止窓・復旧手順を説明して承認を得る。元URL外部移管は正式手順未確認なので維持可能と約束しない。元Sitesは削除しない。DNS/URL/課金/フラグ切替は今回実施しない。
8. **切戻し**: 互換コード（FixedLengthStream維持）を使い、元DB/PDFを古いものへ置換しない。新環境の追加/更新/削除をjournalとhashで保全し、再同期のID衝突/利用者対応を解決。新規データを捨てる単純URL切戻しをしない。新データの取得ができなければ一時読取専用で保全し担当者判断を待つ。

## 復旧運用の設計案（未稼働）
目標RPO24h/RTO4hは目標で保証ではない。日次manifest、完了世代だけ採用、最低2完成世代、独立権限の保存先・鍵分離・TLS・保存暗号化を設計する。月1回新領域へ復元して所要時間を測る。backup失敗/未実行/不一致/容量/barrier停止を通知し到達確認。通知先・権限・利用料金は未確定で勝手に契約/送信しない。
削除台帳は世代backupと別に保管し、復元公開前に最新のdeleted/deletingを再適用。本人session失効と直近再認証を確認。個人データのbackup保持上限30日は提案で、正式規約/例外/現Sites保持は未確定。期限後の全世代・鍵・複製を消去し証跡を照合する。R2 lifecycleだけで厳密な時刻の消去保証としない。長期保持は消去期限と費用に影響するので旧長期世代案を自動採用しない。
結果不明要求は旧worker/下流終了の証明を得るまで解除せず、操作ID/世代keyとDBの有効世代commit条件で旧結果を本体として公開しない設計・試験を追加する必要がある。S3 multipart一覧/abortだけで終了保証を得たことにしない。

## 当時の参考操作（報告済み項目の再実施依頼は撤回）
1. PCでversion22を強制再読込→許可済みテストPDFの本文検索→左欄を最終結果までスクロール。「最後が見える/見えない」、OS/ブラウザー/画面幅/倍率を報告。
2. 自作2冊の専用アカウントAで表紙を第1ページ→指定画像へ変更→再読込。欠ける場合は設定・操作順・時刻・伏せた画像を報告。秘密情報を含むHARは不要。
3. PCのデータ管理で空folderへ保存→途中中断→再開し、COMPLETE.json有無を報告。非対応スマホではメタデータ/PDF/索引個別保存の案内を確認。私有ファイル自体をGitHubへ提出しない。
4. 専用A/Bと実タブレット/スマホを用意できたらuser-acceptance-checklist.mdの残りを実施。「日時/端末/項目/期待/結果/未実施」で結果だけを提出。アカウント作成/招待はこちらからしない。
5. 管理可能な環境の推奨はA。ただし今は選定への意見だけでよく、契約/課金設定や本番移行を行う必要はない。Sitesの同じ問い合わせを繰り返すことも今回の必須操作ではない。
