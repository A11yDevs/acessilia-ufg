# Guia de Implantação e Operação (Deployment) — Acessilia Gestor

Este documento orienta a instalação e manutenção em ambiente de produção (VPS, servidores Linux locais ou contêineres Docker), garantindo alta disponibilidade, integridade do banco SQLite e conexões persistentes para Server-Sent Events (SSE).

---

## 1. Pré-requisitos de Infraestrutura

* **Sistema Operacional:** Linux (Ubuntu 22.04 LTS / Debian 12 recomendados) ou Docker Engine 24+.
* **Hardware Mínimo:** 1 vCPU, 1 GB de memória RAM, 10 GB de disco SSD.
* **Node.js:** Versão 18 LTS ou superior (recomendado Node.js 20+ ou 22+).
* **Proxy Reverso:** Nginx com suporte a HTTP/2 e desativação de buffering para SSE.

---

## 2. Variáveis de Ambiente (`.env`)

Crie o arquivo `.env` a partir do modelo institucional:

```bash
cp .env.example .env
```

| Variável | Descrição | Exemplo em Produção |
|---|---|---|
| `NODE_ENV` | Modo de execução do Node.js | `production` |
| `PORT` | Porta de escuta da aplicação | `3000` |
| `SESSION_SECRET` | Chave criptográfica aleatória (mínimo 32 caracteres) | `super_secret_session_key_32_chars_min` |
| `DATABASE_PATH` | Caminho do arquivo SQLite | `database/acessilia.sqlite` |
| `BOT_ACESS_API_URL` | Endereço do motor Acessilia Core | `http://acessilia-core:8000` |
| `BOT_ACESS_API_KEY` | Chave de autenticação opcional do Core | `token_secreto_core` |
| `UPLOAD_DIR` | Diretório de armazenamento de uploads | `uploads` |

---

## 3. Implantação com Docker Compose

A forma recomendada para ambientes isolados:

```bash
# Iniciar os contêineres em background
docker compose up -d

# Executar as migrações no banco
docker compose exec app npm run migrate

# (Opcional) Popular dados de demonstração
docker compose exec app npm run seed
```

---

## 4. Configuração do Proxy Reverso Nginx

Para permitir que o canal de Server-Sent Events (`/api/v1/notifications/stream`) funcione sem atrasos de buffer, configure o bloco no Nginx:

```nginx
server {
    listen 80;
    server_name acessilia.instituicao.edu.br;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name acessilia.instituicao.edu.br;

    ssl_certificate /etc/letsencrypt/live/acessilia.instituicao.edu.br/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/acessilia.instituicao.edu.br/privkey.pem;

    # Cabeçalhos de Segurança
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Limite de tamanho de upload (ex: apostilas e PDFs pesados de até 100MB)
    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Configuração Mandatória para Server-Sent Events (SSE)
    location /api/v1/notifications/stream {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
        proxy_read_timeout 24h;
    }
}
```

---

## 5. Estratégia de Backup a Quente do SQLite

O sistema utiliza a **Online Backup API** do SQLite via `better-sqlite3`, permitindo cópias consistentes e atômicas mesmo durante uploads concorrentes.

Para gerar um backup manual:
```bash
node -e "import('./src/services/backup.service.js').then(s => s.backupService.performBackup())"
```

Os backups são salvos em `database/backups/` e uma rotina automática retém os últimos 10 snapshots, eliminando arquivos antigos.

---

## 6. Monitoramento de Saúde

A rota de health check pode ser monitorada por ferramentas externas a cada 30 segundos:
```bash
curl -f http://localhost:3000/healthz
```
