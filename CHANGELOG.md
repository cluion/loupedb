# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，版本號遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [Unreleased]

### Added

- **範圍選取與試算表複製貼上**：DataGrid 可用滑鼠拖曳、Shift＋方向鍵選取可見儲存格矩形，以 TSV 複製並保留公式注入防護；可貼上 Excel、Numbers 或 Google Sheets 的矩形資料，貼上前會完整驗證頁面邊界、row identity、row version 與欄位可編輯性，任一儲存格不安全即整批拒絕，通過後加入既有 staged changes 等待全部套用或回復

## [0.17.0] - 2026-07-18

### Added

- **欄位顯示設定**：DataGrid 可隱藏與重新排序欄位、拖曳表頭或輸入數值調整 80–600px 欄寬，並凍結前置可見欄位供水平捲動比對；設定依連線名稱、資料庫與資料表保存在瀏覽器，schema 新增或移除欄位時會自動合併並維持至少一個可見欄位

## [0.16.0] - 2026-07-18

### Added

- **多條件 Filter Builder**：DataGrid 可新增多個條件並選擇全部符合 `AND` 或任一符合 `OR`，支援比較、`LIKE`／`ILIKE` 與 `IS NULL`／`IS NOT NULL` 等參數化運算子；最近 10 組篩選依連線名稱、資料庫與資料表保存在瀏覽器，可一鍵重新套用或清除

## [0.15.0] - 2026-07-18

### Added

- **Connection Safety Mode**：連線可標示 Development、Staging 或 Production 並在已存連線與工作區顯示環境色；Production 預設 Safe mode，SQL 工作台與 DataGrid 對 `UPDATE`、`DELETE`、`DROP`、`TRUNCATE` 要求明確確認；Read-only mode 同時由 API policy 與 PostgreSQL `default_transaction_read_only` 阻止寫入，安全設定會隨連線保存並由 sibling database session 沿用

## [0.14.0] - 2026-07-18

### Added

- **Staged Data Changes**：DataGrid 的 cell update、insert／Clone 與 delete 先保留在瀏覽器並標記 dirty，提供完整 parameterized SQL 清單、全部回復與全部套用；批次依暫存順序在同一 PostgreSQL transaction 內執行，每列首次寫入同時比對原值與 `xmin`，任一 stale row 或寫入錯誤會 rollback 整批且保留待處理清單；切換資料表、結構頁或離開網頁前會阻止未確認的變更遺失

## [0.13.0] - 2026-07-18

### Added

- **Unique Key 安全資料列定位**：沒有 primary key 的資料表可改用完整、非 NULL 的 PostgreSQL unique index 定位資料列，支援 inline editing 與搭配 `xmin` 的安全刪除；partial、expression、無效 index 與含 NULL 的唯一鍵值維持唯讀，Clone 會清空 unique key 欄位以避免衝突
- **多 Statement 執行範圍提示**：SQL 草稿含多個 statement 時，主要按鈕明確顯示「執行目前語句」，編輯器加強標示即將執行的範圍，並提示「執行全部」才會由上到下執行完整 Script

## [0.12.0] - 2026-07-18

### Added

- **資料列新增、Clone 與刪除**：DataGrid 依 schema metadata 產生新增表單，支援 DEFAULT、明確 NULL 與 Clone 預填；寫入前顯示 parameterized `INSERT`／`DELETE` 與 bind values，刪除必須匹配完整 primary key 與 PostgreSQL `xmin` row version，無主鍵資料表仍可新增但不可刪除

## [0.11.0] - 2026-07-18

### Added

- **安全 Cell Inline Editing**：具 primary key 的資料表可雙擊非主鍵純量欄位編輯；寫入前顯示 parameterized `UPDATE` 與 bind values，確認後最多更新一列，並以原值條件阻止覆蓋並行變更；無主鍵、主鍵欄位、複雜型別及手動交易期間維持唯讀

## [0.10.0] - 2026-07-18

### Added

- **已存查詢整理**：可將查詢加入收藏並以資料夾、標籤分類，支援收藏／資料夾／標籤篩選及跨欄位搜尋；舊版 `saved-queries.json` 會自動套用相容預設值，同名更新 SQL 時保留整理資訊

## [0.9.0] - 2026-07-18

### Added

- **PostgreSQL Function Autocomplete**：SQL 編輯器載入非系統 schema 中目前帳號可執行的 function、aggregate 與 window function，補全項目顯示呼叫形式、參數簽名與回傳型別；同名 overload 合併顯示，選取後插入函式呼叫開頭

## [0.8.0] - 2026-07-18

### Added

- **Manual Transaction Mode**：每個 connection 可由 SQL 工作台開始交易，後續 statement、參數查詢與完整 script 固定使用同一條 PostgreSQL connection；介面明確顯示自動提交、交易中或交易失敗，提供 Commit／Rollback，查詢失敗或取消後要求先 Rollback，中斷連線時自動回滾

## [0.7.0] - 2026-07-18

### Added

- **Query Parameters**：執行含 `$1`、`$2` 等 PostgreSQL placeholder 的目前 statement 或選取 SQL 前顯示參數表單，支援空字串與明確 `NULL`，並以 bind values 傳送而不拼接 SQL；字串、dollar-quote、註解與 quoted identifier 內的 `$n` 不會誤判，參數值不寫入歷史或 localStorage

## [0.6.0] - 2026-07-17

### Added

- **前次結果比對**：每個 SQL 分頁在新一次執行時保留上一份結果，可在目前／前次結果間切換並查看各自列數；一般查詢與完整 script 都適用，兩份結果只留在記憶體且不寫入 localStorage
- **PostgreSQL 查詢訊息**：顯示一般查詢與完整 script 各 statement 產生的 NOTICE、WARNING、INFO、LOG 與 DEBUG，包含 SQLSTATE、detail、hint 與 context；失敗前已送出的訊息也會保留，並以獨立連線 slot 避免並行查詢互相混入訊息

## [0.5.0] - 2026-07-17

### Added

- **完整 SQL Script 與多結果分頁**：多 statement 草稿可選擇依序執行全部，每個 SELECT、affected rows 或錯誤各自保留為結果分頁；全部 statement 固定使用同一條 PostgreSQL connection 且逐句 autocommit，第一個錯誤停止後續，取消目前 statement 後也不再繼續執行

## [0.4.0] - 2026-07-17

### Added

- **PostgreSQL SQL Formatter**：可用工具列、`⇧⌥F`（macOS）或 `Shift+Alt+F` 格式化整份 SQL；有選取範圍時只格式化選取內容，保留游標／選取狀態，解析失敗不覆蓋原始草稿

## [0.3.0] - 2026-07-17

### Added

- **SQL 查詢停止控制**：editor 為每次執行產生 query ID，執行中可停止並沿用既有 PostgreSQL cancel 管線；取消期間阻止重疊執行，避免較晚回來的舊 response 覆蓋新結果
- **執行摘要與三態歷史**：顯示開始時間、執行時間、結果列數或 affected rows；查詢歷史明確區分成功、失敗、使用者取消，並相容遷移 v0.2 的既有 localStorage 紀錄

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

[Unreleased]: https://git.cluion.com/ningyungame/loupedb/compare/v0.17.0...HEAD
[0.17.0]: https://git.cluion.com/ningyungame/loupedb/releases/tag/v0.17.0
[0.16.0]: https://git.cluion.com/ningyungame/loupedb/releases/tag/v0.16.0
[0.15.0]: https://git.cluion.com/ningyungame/loupedb/releases/tag/v0.15.0
[0.14.0]: https://git.cluion.com/ningyungame/loupedb/releases/tag/v0.14.0
[0.13.0]: https://git.cluion.com/ningyungame/loupedb/releases/tag/v0.13.0
[0.12.0]: https://git.cluion.com/ningyungame/loupedb/releases/tag/v0.12.0
[0.11.0]: https://git.cluion.com/ningyungame/loupedb/releases/tag/v0.11.0
[0.10.0]: https://git.cluion.com/ningyungame/loupedb/releases/tag/v0.10.0
[0.9.0]: https://git.cluion.com/ningyungame/loupedb/releases/tag/v0.9.0
[0.8.0]: https://git.cluion.com/ningyungame/loupedb/releases/tag/v0.8.0
[0.7.0]: https://git.cluion.com/ningyungame/loupedb/releases/tag/v0.7.0
[0.6.0]: https://git.cluion.com/ningyungame/loupedb/releases/tag/v0.6.0
[0.5.0]: https://git.cluion.com/ningyungame/loupedb/releases/tag/v0.5.0
[0.4.0]: https://git.cluion.com/ningyungame/loupedb/releases/tag/v0.4.0
[0.3.0]: https://git.cluion.com/ningyungame/loupedb/releases/tag/v0.3.0
[0.2.0]: https://git.cluion.com/ningyungame/loupedb/releases/tag/v0.2.0
[0.1.0]: https://git.cluion.com/ningyungame/loupedb/releases/tag/v0.1.0
