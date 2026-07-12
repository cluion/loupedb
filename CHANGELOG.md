# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，版本號遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

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

[0.1.0]: https://git.cluion.com/ningyungame/loupedb/releases/tag/v0.1.0
