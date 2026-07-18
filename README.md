# LoupeDB

[![CI](https://git.cluion.com/ningyungame/loupedb/actions/workflows/ci.yml/badge.svg?branch=main)](https://git.cluion.com/ningyungame/loupedb/actions?workflow=ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-d9a441.svg)](LICENSE)

開源、網頁版、支援多種資料庫、UI 出色的資料庫管理工具。[cluion](https://cluion.com) 旗下產品。

MVP 支援 **PostgreSQL**（driver 抽象層已就緒，MySQL/SQLite 規劃中）。

## 特色

- **網頁介面**：連線管理、schema 樹狀瀏覽、資料表分頁／排序、多條件 `AND`／`OR` Filter Builder 與最近篩選歷史、可保存的欄位隱藏／寬度／順序／凍結設定、以 primary key 或非 NULL unique key 定位的安全 inline editing、資料列新增／Clone／刪除、dirty 標記與 staged changes（參數化 SQL 預覽、全部套用／回復、transaction rollback、原值與 row version 檢查）、大結果 SSE 串流（可取消）
- **SQL 工作台**：多分頁編輯器（草稿自動保存）、明確區分執行選取／目前語句／完整 Script、`$n` query parameters、manual transaction（狀態、Commit、Rollback）、多結果分頁、目前／前次結果比對、PostgreSQL NOTICE/WARNING 訊息、執行中查詢可停止、PostgreSQL 格式化、schema/table/column/function 自動補全、查詢歷史、可收藏並以資料夾／標籤整理的已存查詢、結果匯出 CSV/TSV/JSON/Markdown
- **安全預設**：連線環境 Development／Staging／Production 色彩標示、Production 預設 Safe mode、危險 SQL 二次確認、API 與 PostgreSQL session 雙層 Read-only、連線密碼 AES-256-GCM 加密儲存、SSL 智能判斷（本機/內網 disable、公網 require、永遠可覆寫）、查詢逾時與 session 上限、錯誤訊息遮蔽 credential
- **單一容器自架**：一個 Docker image、一個 volume，沒有額外依賴

## 快速開發

```bash
pnpm install
pnpm run dev       # http://localhost:3000
```

需要 Node.js 24 LTS 與 pnpm（`corepack enable` 即可）。跑測試需要 Docker（整合測試用 testcontainers 起真實 PostgreSQL）：

```bash
pnpm test           # 單元 + 整合測試
pnpm run test:e2e   # Playwright E2E
```

## Docker 部署

```bash
cp .env.example .env
# 產生加密金鑰並填入 .env 的 LOUPEDB_MASTER_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

docker compose up -d   # http://127.0.0.1:3000
```

預設只綁定本機（127.0.0.1）。要開放到公網請務必透過 HTTPS reverse proxy，詳見 [docs/deploy.md](docs/deploy.md)。

## 環境變數

| 變數 | 必填 | 說明 |
|---|---|---|
| `LOUPEDB_MASTER_KEY` | 是 | 32-byte hex（64 字元），加密連線密碼用 |
| `LOUPEDB_APP_PASSWORD` | 否 | 設定後整個介面需輸入此密碼解鎖 |
| `LOUPEDB_DATA_DIR` | 否 | 連線設定存放目錄（預設 `./data`） |
| `LOUPEDB_MAX_SESSIONS` | 否 | 同時連線上限（預設 20） |
| `LOUPEDB_IDLE_TIMEOUT_MS` | 否 | 閒置連線回收時間（預設 30 分鐘） |

## 參與貢獻

見 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

[MIT](LICENSE)
