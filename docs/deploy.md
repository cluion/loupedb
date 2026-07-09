# LoupeDB 部署指南

## 為什麼不要直接暴露公網

LoupeDB 的本質是「拿著你資料庫 credential 的工具」。瀏覽器與 LoupeDB 之間會傳輸：

- 新增連線時的資料庫密碼
- 查詢結果（可能含敏感資料）
- app 密碼（若啟用）

沒有 HTTPS 這些都是明文。因此：

1. **預設只綁 127.0.0.1**（compose 的 ports 設定），本機使用零設定
2. **要公網/團隊使用，一律走 HTTPS reverse proxy**（下方範例）
3. 建議同時啟用 `LOUPEDB_APP_PASSWORD`

## HTTPS reverse proxy

### Caddy（推薦，自動 HTTPS）

見 [Caddyfile.example](../Caddyfile.example)：

```caddyfile
loupedb.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy 會自動申請與更新 Let's Encrypt 憑證。SSE 串流無需額外設定。

### nginx

```nginx
server {
    listen 443 ssl;
    server_name loupedb.example.com;
    # ssl_certificate / ssl_certificate_key ...

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;   # SSE 串流必須關 buffering
        proxy_read_timeout 3600s;
    }
}
```

## MASTER_KEY 產生與輪替

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- 金鑰只放環境變數（`.env`），**絕不 commit**
- 輪替步驟：目前版本無自動重加密,輪替金鑰後既有連線設定將無法解密,需刪除 `data/connections.json` 重新建立連線（金鑰自動輪替與 KMS 支援在規劃中）

## app 密碼保護

`.env` 設定 `LOUPEDB_APP_PASSWORD=你的密碼` 即生效：

- 所有 `/api/*` 請求需帶正確密碼，否則 401
- 由 server middleware 檢查 cookie（`loupedb_app_pw`）或 header（`x-loupedb-password`）
- UI 會在偵測到 401 時顯示解鎖畫面，解鎖後密碼存於 cookie

這是單人/小團隊的輕量保護，不是完整的多使用者 auth（後者在規劃中）。

## 部署場景建議

| 場景 | 建議 |
|---|---|
| 本機開發工具 | `docker compose up -d`，預設綁 127.0.0.1 即可 |
| 內網團隊共用 | reverse proxy + HTTPS + `LOUPEDB_APP_PASSWORD` |
| 公網 | 同上，另建議放在 VPN/零信任網路後面 |

## 備份

連線設定（含加密密碼）存在 `loupedb-data` volume 的 `connections.json`：

```bash
docker run --rm -v loupedb_loupedb-data:/data -v "$PWD":/backup alpine \
  cp /data/connections.json /backup/connections-backup.json
```

備份檔內密碼是密文，但仍應妥善保管（搭配 MASTER_KEY 即可解密）。
