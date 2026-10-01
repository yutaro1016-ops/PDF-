# Sites運営元への確認事項（未送信・2026-09-30）

> 2026-10-01訂正: 以下は当時の準備記録。ユーザーがSupportへ問い合わせ、公開資料では正式な全量復旧手順/保証を確認できないとの回答を受けた。機能不存在とは断定しない。同じ問い合わせの再送は今回勧めない。[移行準備](migration-preparation-v22.md)と[管理可能な環境比較](managed-hosting-comparison.md)に未確認事項と回答に依存しない作業を整理した。

対象: PDF Page Finder / appgprj_6abb0a1c108c8191a976513dd82174aa
URL: https://pdf-page-finder.yutaro1016.chatgpt.site/shelf
本書は質問の準備であり、問い合わせは送信していない。

## 現時点の確認範囲
所有者としてソース、バージョン、デプロイ、環境変数、DBスキーマ・行の読み取り、最近のWorkerログを利用できる。これらはDB全量スナップショットとR2全量書き出し・復元の権限を意味しない。利用可能ツールに正式な全量export/restore、復旧ポイント一覧、R2管理用サービス資格情報は公開されていない。利用者向けバックアップは本番全体のバックアップではない。
公開ヘルプから、このプロジェクトの保持期間・復旧保証・請求・全量export APIは確認できなかった。「Sitesに機能が存在しない」と断定せず、利用権限と正式手順が未確認と扱う。Cloudflare一般機能、ChatGPTチャットの保持期間、Library容量枠をSites DB/R2へ適用しない。

## 回答を依頼する具体的な質問
1. 本プロジェクトDBの全テーブル（books/pages/shelves/shares/import_jobs/import_items/account_lifecycle）を整合する一時点で書き出す正式なUI/API/CLIは何か。所有者に必要な追加権限・申請は何か。
2. R2の全オブジェクト・メタデータと進行中multipartを一覧化・取得する正式手順は何か。PDF本体・thumbnailとDBの一時点整合性をどう確保するか。読み取り専用・プロジェクト限定・期限付き資格情報を発行できるか。
3. DB/PDFそれぞれの復旧ポイント、保持期間、更新間隔、誤削除時の復旧期限、復旧依頼方法・担当窓口・費用・RPO/RTO保証は何か。D1 Time Travelは本プロジェクトで利用可能か、誰が実行できるか。
4. 既存プロジェクトを変更しない独立した検証領域に復元可能か。DB/R2だけの別bindingまたは隔離環境を提供できるか。元PDF ID・認証IDの対応、公開URLの維持方法、アクセス制限・追加費用を確認したい。
5. 自動取得用の非対話資格情報は正式に提供されるか。保存先暗号化、鍵管理、リージョン、別障害領域保存、世代管理、復旧ログの対応範囲は何か。
6. 利用者退会後の運営元バックアップ内データの残存期間、削除依頼、法的保持例外、復元時に退会データを再公開しない方法を確認したい。
7. 現契約のストレージ・転送・DB・リクエスト・CPU・multipart・大容量PDFの上限、超過時の挙動、追加請求、公開停止条件、SLAは何か。5GB/利用者を販売上の保証にできるか。
8. GitHub Actionsから同じSitesプロジェクトへ公開する正式な非対話サービス資格情報・API・有効期限・権限分離・承認・監査ログ・ロールバック方法はあるか。
9. 新しいChatGPT再認証の日時を信頼されたサーバー情報として検証できるか。退会のような不可逆操作で利用できる正式なstep-up認証方法を確認したい。
10. 障害通知、ログ保持、エラー集計、通知先設定、Webhook、必要プラン・追加費用を確認したい。

必要権限はDB/R2の読取export、復旧ポイント参照、独立領域へのwrite/restoreを分離する。本番write/deleteや公開先切替は要求・使用前に影響と復旧方法を説明して承認を得る。秘密鍵・資格情報・PDFはGitHub、問い合わせ本文に含めない。

## 回答後の復旧演習
正式機能・費用を確定→必要権限だけ取得→書込整合時点を確定→暗号化取得→独立領域へ復元→PDF ID・全本体SHA256・索引件数/内容・棚設定・所属/順序・画像を照合→別アカウントで権限/検索/共有取消を受入→RPO/RTO実測・失敗通知/鍵復旧を演習。原本を削除・置換しない。DBだけの時点復元で新しいR2を上書きしない。

自動バックアップの日次14・週次8・月次6世代、RPO24時間/RTO4時間は旧運用案の目標で、未稼働・非保証。月次6世代の残存が退会消去期限と矛盾しないかを決めてから採用する。利用者別暗号鍵による失効も候補だが、正式KMS権限と独立復元試験なしに導入しない。

## 監視通知の準備
現状はCIと手動health workflow。受信者がGitHub Settings→Notifications→System→ActionsでEmail/On GitHubと失敗通知を設定し、意図した試験失敗と復旧で通知到達を確認する必要がある。通知のアカウント設定は今回操作していない。定期workflowはdefault branchへの反映と担当者、受信先、予算確認後に有効化する。15分監視は月約2880起動になるため、private repositoryの無料枠/実行時間/予算を確認する。public repositoryのstandard hosted runnerは公式上無償だが、本リポジトリの請求・残枠は未確認。外部通知契約なし、cron有効化なし。

参考（2026-09-30閲覧）:
- https://help.openai.com/en/articles/20001339-creating-and-managing-chatgpt-sites
- https://docs.github.com/en/actions/concepts/billing-and-usage
- https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications

## version21の引継ぎ
[送信用問い合わせ本文と正式窓口手順](support-inquiry-ready.md)、[利用者の実端末受入・提出チェックリスト](user-acceptance-checklist.md)、[異常終了と結果不明の保存操作](storage-operation-recovery.md)を追加。問い合わせは未送信。本番3フラグはOFFを維持。正式な全量バックアップ/独立復元/下流終了証明と実ブラウザー・別アカウントの受入が揃うまで販売は保留。
