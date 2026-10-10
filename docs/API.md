# Referência da API — Acessilia Gestor

Esta documentação descreve todos os endpoints REST, mecanismos de autenticação, Webhooks de integração e streams Server-Sent Events (SSE) do **Acessilia Gestor**.

---

## 1. Padrões de Comunicação e Segurança

* **Base URL:** `http://localhost:3000` (ou domínio institucional configurado)
* **Formato de Carga:** `application/json` ou `multipart/form-data` (upload de arquivos)
* **Controle de Acesso:** Sessões seguras assinadas via cookie HTTP-only (`acessilia_session`), com suporte a autenticação por senha via **Argon2id**.
* **Proteção CSRF:** Formulários e mutações via navegador exigem o token `_csrf`.
* **Rate Limiting:** Proteção ativa contra força bruta nos endpoints de autenticação e consulta.

---

## 2. Autenticação e Sessão

### `POST /login`
Autentica um usuário e inicia uma sessão com controle de tentativas e bloqueio temporário por IP/e-mail.

* **Headers:** `Content-Type: application/x-www-form-urlencoded`
* **Parâmetros do Formulário:**
  * `email` (string, obrigatório): E-mail institucional do usuário.
  * `password` (string, obrigatório): Senha de acesso.
  * `_csrf` (string, obrigatório): Token de integridade CSRF.
* **Respostas:**
  * `302 Found`: Redireciona para `/dashboard` em caso de sucesso.
  * `401 Unauthorized`: Credenciais inválidas.
  * `429 Too Many Requests`: Bloqueio temporário por tentativas excessivas.

### `POST /logout`
Encerra a sessão ativa, invalidando o registro no banco de dados SQLite.

* **Respostas:**
  * `302 Found`: Redireciona para `/login`.

---

## 3. Preferências de Acessibilidade

### `POST /api/v1/usuarios/preferencias`
Salva as preferências visuais de acessibilidade do usuário autenticado no banco de dados para sincronização multidispositivo.

* **Headers:** `Content-Type: application/json`
* **Body (JSON):**
  ```json
  {
    "fontSize": "normal",       // "normal" | "font-lg" | "font-xl"
    "contrastMode": "normal",    // "normal" | "high" | "slate"
    "dyslexiaFont": false,       // boolean
    "readingRuler": false        // boolean
  }
  ```
* **Respostas:**
  * `200 OK`:
    ```json
    { "success": true, "message": "Preferências salvas com sucesso." }
    ```
  * `401 Unauthorized`: Usuário não autenticado.

---

## 4. Gestão de Materiais e Acessibilização

### `GET /materiais`
Lista os materiais acadêmicos acessíveis ao usuário, aplicando regras estritas de escopo (docentes veem seus materiais; discentes veem materiais das turmas matriculadas após a liberação).

* **Respostas:**
  * `200 OK`: Renderiza a visualização do repositório de materiais.

### `POST /materiais`
Realiza o upload de um material acadêmico pelo docente, cria a versão imutável `v1 (ORIGINAL)` e dispara a solicitação assíncrona para o motor Acessilia Core.

* **Headers:** `Content-Type: multipart/form-data`
* **Campos do Formulário:**
  * `title` (string, obrigatório): Título do material.
  * `subjectId` (integer, obrigatório): ID da disciplina vinculada.
  * `classId` (integer, opcional): ID da turma específica.
  * `category` (string, obrigatório): Ex: `SLIDES`, `LIVRO`, `APOSTILA`, `ARTIGO`.
  * `publishAt` (string, opcional): Data/hora ISO para liberação agendada aos estudantes.
  * `document_file` ou `file` (binary, obrigatório): Arquivo nos formatos PDF, DOCX, DOC, PPTX, PPT, TXT, PNG, JPG.
* **Respostas:**
  * `302 Found`: Redireciona para `/materiais/:id`.
  * `400 Bad Request`: Formato de arquivo não suportado ou validação falha.

### `GET /materiais/:id/download`
Realiza o download seguro do material acessibilizado no formato selecionado, com inclusão obrigatória do Selo Acessilia e metadados de certificação.

* **Query Parameters:**
  * `format` (string, padrão `html`): `html`, `txt`, `docx`, `pdf`, `pdf_ua`, `mp3`, `zip`.
* **Respostas:**
  * `200 OK`: Stream binário ou textual do arquivo acessível formatado.
  * `403 Forbidden`: Aluno tentando acessar material não matriculado ou com agendamento futuro pendente.
  * `404 Not Found`: Material ou versão não encontrada.

---

## 5. Webhook e Integração com Acessilia Core

### `POST /api/v1/webhooks/bot-acess`
Endpoint seguro consumido pelo motor Acessilia Core para notificar o término do processamento assíncrono de documentos.

* **Headers:** `Content-Type: application/json`
* **Body (JSON):**
  ```json
  {
    "job_id": 104,
    "task_id": "ext_acessilia_abc123",
    "status": "COMPLETED",               // "COMPLETED" | "FAILED"
    "processed_document_url": "/uploads/accessible_abc123.html",
    "confidence_score": 0.98,
    "error_message": null
  }
  ```
* **Ações Executadas:**
  1. Criação atômica da versão `v2 (PROCESSADO_BOT)`.
  2. Atualização do status do material para `AGUARDANDO_REVISAO`.
  3. Geração de sugestões de Alt-Text para validação humana.
  4. Emissão imediata de evento SSE para atualização da interface.
* **Respostas:**
  * `200 OK`:
    ```json
    { "success": true, "message": "Webhook processado com sucesso." }
    ```
  * `400 Bad Request`: Parâmetros obrigatórios ausentes.

---

## 6. Notificações em Tempo Real (Server-Sent Events)

### `GET /api/v1/notifications/stream`
Canal contínuo de eventos unidirecionais via SSE para atualização instantânea de dashboards, tabelas e barras de progresso do processamento.

* **Headers de Resposta:**
  * `Content-Type: text/event-stream`
  * `Cache-Control: no-cache`
  * `Connection: keep-alive`
* **Tipos de Eventos Emitidos:**
  * `PROCESSING_PROGRESS`:
    ```json
    {
      "type": "PROCESSING_PROGRESS",
      "materialId": 12,
      "jobId": 104,
      "progress": 75,
      "currentStep": "Sintetizando áudio MP3 (75%)",
      "status": "PROCESSANDO"
    }
    ```
  * `MATERIAL_UPDATED`:
    ```json
    {
      "type": "MATERIAL_UPDATED",
      "materialId": 12,
      "status": "AGUARDANDO_REVISAO",
      "title": "Material Processado",
      "message": "Processamento de IA concluído com sucesso."
    }
    ```

---

## 7. Certificação Digital Pública

### `GET /certificados/:hash`
Página pública (sem necessidade de login) para verificação da autenticidade e conformidade de um documento acessibilizado via QR Code.

* **Parâmetros de Rota:**
  * `hash` (string, 64 caracteres): Hash SHA-256 da versão do material.
* **Respostas:**
  * `200 OK`: Renderiza a página oficial do Certificado Digital de Acessibilidade com carimbo de tempo, dados do revisor e status do Selo Acessilia.
  * `404 Not Found`: Certificado não localizado na base de registros imutáveis.

---

## 8. Auditoria, Saúde e Relatórios

### `GET /healthz`
Health check operacional da plataforma para orquestradores (Docker, Kubernetes ou Uptime Kuma).

* **Respostas:**
  * `200 OK`:
    ```json
    {
      "status": "ok",
      "timestamp": "2026-10-10T13:45:00.000Z",
      "uptimeSeconds": 1420.5,
      "database": "connected"
    }
    ```

### `GET /relatorios/auditoria.csv`
Exportação em formato CSV da trilha de auditoria e logs de conformidade com a Lei Brasileira de Inclusão (LBI).

* **Permissão Necessária:** `auditoria.visualizar` (Administrador).
* **Respostas:**
  * `200 OK`: Arquivo CSV com cabeçalho `Content-Disposition: attachment; filename="relatorio_auditoria_...csv"`.
