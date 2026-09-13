# BOT-ACESS — Painel Institucional Web

Painel Institucional Web independente para gestão de acessibilidade acadêmica, cursos, turmas, docentes, discentes, materiais e integração desacoplada com a plataforma **bot-acess**.

---

## 1. Visão Geral e Arquitetura

O sistema foi concebido como um produto corporativo de alta confiabilidade, leveza para execução em VPS de baixo custo e conformidade estrita com normas de acessibilidade (**WCAG 2.2 / WAI-ARIA**).

* **Backend**: Node.js com **Fastify** em arquitetura orientada a plugins e decorators.
* **Banco de Dados**: **SQLite** em modo WAL (`better-sqlite3`), com chaves estrangeiras ativas e 30 tabelas normalizadas.
* **Segurança e Criptografia**: **Argon2id** mandatório, sessões persistentes no SQLite, tokens CSRF nos formulários e proteção contra força bruta.
* **Frontend**: HTML5 Semântico, CSS3 Moderno com suporte a Dark Mode e Vanilla JavaScript acessível.
* **Integração com bot-acess**: Camada desacoplada em `src/integrations/bot-acess/` com rastreamento assíncrono via `processing_jobs` e idempotência rigorosa.

---

## 2. Instalação e Execução

### Pré-requisitos
* Node.js v18+ (testado no Node.js v26 LTS)
* npm v9+

### Passos

1. Clone o repositório e instale as dependências:
   ```bash
   npm install
   ```

2. Configure as variáveis de ambiente:
   ```bash
   cp .env.example .env
   ```

3. Execute as migrações do banco SQLite:
   ```bash
   npm run migrate
   ```

4. Popule os dados iniciais de desenvolvimento:
   ```bash
   npm run seed
   ```

5. Execute a suíte de testes:
   ```bash
   npm test
   ```

6. Inicie o servidor:
   ```bash
   npm run dev
   # ou para produção:
   npm start
   ```

Acesse em: `http://localhost:3000`

---

## 3. Credenciais de Teste (Ambiente de Desenvolvimento)

A senha padrão para todos os usuários criados pelo seed é: `Temp@123456`

| Papel | E-mail | Matrícula |
| :--- | :--- | :--- |
| **Administrador** | `admin@acessilia.ufg.br` | `ADM-001` |
| **Professor** | `carlos.professor@acessilia.ufg.br` | `DOC-1020` |
| **Revisora** | `ana.revisora@acessilia.ufg.br` | `REV-3040` |
| **Estudante** | `lucas.aluno@acessilia.ufg.br` | `ALU-202601` |

---

## 4. Estrutura Modular

```text
├── database/
│   ├── connection.js             # Conexão SQLite com pragmas WAL e foreign keys
│   ├── migrate.js                # Runner atômico de migrações
│   ├── seed.js                   # População de papéis, permissões e usuários
│   └── migrations/               # Scripts DDL das 30 tabelas relacionais
├── src/
│   ├── app.js                    # Configuração dos plugins Fastify
│   ├── server.js                 # Inicialização do servidor HTTP
│   ├── config/                   # Variáveis de ambiente e constantes
│   ├── plugins/                  # Sessões no SQLite, RBAC e decorators
│   ├── repositories/             # Camada de persistência e consultas preparadas
│   ├── services/                 # Regras de negócio e validação de escopo
│   ├── integrations/             # Cliente e serviços desacoplados do bot-acess
│   └── views/                    # Templates EJS acessíveis com WCAG 2.2
└── tests/
    ├── unit/                     # Testes de unidade e autenticação
    └── integration/              # Testes de autorização, escopo e fluxo de materiais
```
