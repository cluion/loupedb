# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，版本號遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [0.2.0] - 2026-07-17

Query Workbench：讓 LoupeDB 從「能執行 SQL」升級為每天可以持續使用的 SQL 工作區。

### Added

- **多分頁 SQL 工作台**：分頁可新增、命名、拖曳排序、關閉，各自綁定 database/schema context；草稿自動保存，重新整理或重啟瀏覽器後完整還原（查詢結果刻意不落地，避免敏感資料寫入瀏覽器）
- **連線 session 還原**：重新整理後自動恢復上次連線；伺服器重啟導致 session 失效時乾淨回到連線畫面
- **執行選取或游標所在 statement**：以 lezer 語法樹解析 statement 邊界（字串、註解、dollar-quote 內的分號不誤切）；多 statement 草稿會高亮即將執行的那條，按鈕顯示「執行」或「執行選取」
- **查詢歷史**：依連線名稱累積於瀏覽器（上限 200 筆），記錄成敗、耗時、列數與執行時的 database，點一下開新分頁重跑，可清空
- **已存查詢**：儲存於伺服器端 `saved-queries.json`，跨瀏覽器共用；同名覆寫、名稱與 SQL 內文搜尋、二段確認刪除
- **結果匯出**：目前載入的查詢結果或資料頁可以 CSV/TSV/JSON/Markdown 複製或下載（RFC 4180 引號、NULL 與型別正確處理）
- **Schema-aware 自動補全**：schema、資料表、欄位補全；新增 bulk columns API 一次載入整個 schema 的 metadata，並依分頁 context 切換
- **品質**：224 個 vitest 測試（driver/API/unit/security），Playwright E2E 涵蓋以上所有流程

### Security

- CSV/TSV 匯出對以 `=` `+` `-` `@` 開頭的字串值加 `'` 前綴，防止在試算表中觸發公式注入；數字與 JSON/Markdown 匯出不受影響

## [0.1.0] - 2026-07-12

首個公開版本。MVP 支援 PostgreSQL。

### Added

- **連線管理**：建立/儲存/重連/刪除連線，密碼以 AES-256-GCM 加密存放，SSL 依主機智能判斷（本機/內網 disable、公網 require，永遠可手動覆寫）
- **整台伺服器瀏覽**：MySQL 式體驗——連上一台 PostgreSQL 即可瀏覽所有資料庫（伺服器端 sibling session，隨主連線一併關閉）
- **Schema 樹**：資料庫 → schema → 資料表三層瀏覽
- **資料瀏覽**：分頁、排序、單欄篩選（欄名與運算子白名單防注入）
- **資料表結構檢視**：欄位型別、主鍵、外鍵目標、enum 偵測
- **SQL 編輯器**：CodeMirror 6、PostgreSQL 語法高亮、`Mod-Enter` 執行
- **大結果串流**：SSE 逐批傳輸，可中途取消
- **安全預設**：錯誤訊息遮蔽 credential、查詢逾時、session 上限、閒置連線回收、選配的介面密碼（`LOUPEDB_APP_PASSWORD`）
- **driver 抽象層**：`DatabaseDriver` 介面 + registry，為第二個資料庫引擎預留擴充點
- **部署**：多階段 Dockerfile、docker-compose（預設僅綁 127.0.0.1）、部署文件
- **品質**：153 個 vitest 測試（單元 + testcontainers 整合 + Nuxt e2e）、Playwright E2E、coverage 88%、CI（lint / typecheck / test / build）

[0.2.0]: https://git.cluion.com/ningyungame/loupedb/releases/tag/v0.2.0
[0.1.0]: https://git.cluion.com/ningyungame/loupedb/releases/tag/v0.1.0
