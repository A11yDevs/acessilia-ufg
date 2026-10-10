# ACESSILIA GESTOR — Plataforma Institucional de Acessibilidade Acadêmica

[![Acessibilidade WCAG 2.2 AAA](https://img.shields.io/badge/Acessibilidade-WCAG%202.2%20AAA-success?style=flat-square)](docs/ACCESSIBILITY.md)
[![Conformidade LBI](https://img.shields.io/badge/Conformidade-Lei%2013.146%2F2015-blue?style=flat-square)](docs/ACCESSIBILITY.md)
[![Testes Automatizados](https://img.shields.io/badge/Testes-48%20passando-success?style=flat-square)](tests)
[![Node.js](https://img.shields.io/badge/Node.js-v18%2B%20LTS-green?style=flat-square)](package.json)
[![Fastify](https://img.shields.io/badge/Fastify-v4-black?style=flat-square)](src/app.js)
[![SQLite WAL](https://img.shields.io/badge/SQLite-Modo%20WAL-lightgrey?style=flat-square)](database/connection.js)

Painel Institucional Web para gestão completa de acessibilidade acadêmica, cursos, turmas, docentes, discentes, acervo inclusivo e integração desacoplada com o motor de inteligência artificial **Acessilia Core** e **Acessilia Toolbox**.

---

## 1. Destaques e Recursos Principais

* **Selo Acessilia & Certificação Digital com QR Code:** Emissão de selos institucionais com carimbo de tempo, histórico imutável e validação pública instantânea via QR Code.
* **Web Reader Acessível Integrado:** Leitor web com tipografia ajustável (incluindo fonte adaptada para Dislexia), modos de contraste (Alto Contraste e Dark Slate), espaçamento expansível e sintetizador de voz.
* **Cards de Audiodescrição para Figuras:** Converte elementos visuais do Core em cards estruturados com audiodescrição completa e botão para reprodução por voz e cópia rápida.
* **Notação Matemática Acessível com Verbalização:** Suporte a equações da Toolbox (`math.verbalize`), permitindo aos estudantes ouvir a fórmula descrita em português falado por extenso.
* **Barra de Acessibilidade Fixa:** Régua de leitura virtual focal (atalho `Alt + R`), atalhos globais de teclado (`?`), saltos para conteúdo (*Skip Links*) e sincronização de preferências no banco de dados.
* **Acompanhamento em Tempo Real via SSE:** Barra de progresso conectada às etapas granulares do Core (*Docling*, *PDDL Planner*, *Síntese MP3*) com recarregamento automático ao concluir.
* **Segurança e RBAC Estrito:** Criptografia **Argon2id**, proteção contra ataques de força bruta, prevenção de IDOR com escopo por turma e matrícula, e proteção do último administrador.

---

## 2. Início Rápido (Quickstart)

### Pré-requisitos
* **Node.js** v18+ LTS (recomendado v20+ ou v22+)
* **npm** v9+

### Passos de Instalação

1. Clone o repositório e instale as dependências:
   ```bash
   git clone https://github.com/A11yDevs/acessilia-ufg.git
   cd acessilia-ufg
   npm install
   ```

2. Configure o arquivo de variáveis de ambiente:
   ```bash
   cp .env.example .env
   ```

3. Execute as migrações atômicas do banco SQLite:
   ```bash
   npm run migrate
   ```

4. Popule os dados iniciais de demonstração (departamentos, cursos, turmas e usuários):
   ```bash
   npm run seed
   ```

5. Execute a suíte completa de testes automatizados:
   ```bash
   npm test
   ```

6. Inicie o servidor em modo de desenvolvimento:
   ```bash
   npm run dev
   ```

Acesse no navegador: **`http://localhost:3000`**

---

## 3. Credenciais de Acesso (Ambiente de Desenvolvimento)

A senha padrão para todos os usuários criados no seed é: `Temp@123456`

| Papel (Perfil) | E-mail Institucional | Matrícula | Principais Acessos |
|---|---|---|---|
| **Administrador** | `admin@acessilia.ufg.br` | `ADM-001` | Acesso total, usuários, auditoria e backups |
| **Gestor de Acessibilidade** | `gestor@acessilia.ufg.br` | `GST-002` | Supervisão geral do acervo e relatórios LBI |
| **Docente (Professor)** | `carlos.professor@acessilia.ufg.br` | `DOC-1020` | Envio de materiais e agendamento de liberação |
| **Revisora de Acessibilidade** | `ana.revisora@acessilia.ufg.br` | `REV-3040` | Revisão humana, aprovação de alt-texts e homologação |
| **Discente (Estudante)** | `lucas.aluno@acessilia.ufg.br` | `ALU-202601` | Acesso aos materiais matriculados e Web Reader |

---

## 4. Estrutura de Pastas do Projeto

```text
acessilia-ufg/
├── database/
│   ├── connection.js             # Conexão SQLite com pragmas WAL e foreign keys ativas
│   ├── migrate.js                # Executor atômico de migrações DDL
│   ├── seed.js                   # População de papéis, permissões e usuários iniciais
│   └── migrations/               # Scripts SQL das 30 tabelas relacionais
├── docs/                         # Documentação técnica detalhada
│   ├── ACCESSIBILITY.md          # Manual de conformidade WCAG 2.2 AAA e LBI
│   ├── API.md                    # Referência completa de endpoints REST e SSE
│   ├── ARCHITECTURE.md           # Engenharia, segurança e ciclo de versões
│   ├── CORE_INTEGRATION.md       # Integração com Acessilia Core e Toolbox
│   ├── DEPLOYMENT.md             # Guia de implantação em produção (Docker/Nginx)
│   └── diagrams/                 # Diagramas de sequência e classes PlantUML
├── public/                       # Folhas de estilo acessíveis, scripts e manifest PWA
├── src/
│   ├── app.js                    # Registro dos plugins Fastify, middlewares e rotas
│   ├── server.js                 # Inicialização do servidor HTTP Fastify
│   ├── integrations/             # Cliente HTTP desacoplado e serviços do bot-acess
│   ├── repositories/             # Camada de persistência e prepared statements SQLite
│   ├── services/                 # Regras de negócio, autorização e validação de escopo
│   ├── utils/                    # Utilitários de hash Argon2id e parser de metadados do Core
│   └── views/                    # Telas e componentes EJS estruturados
└── tests/
    ├── unit/                     # Testes unitários (Argon2id, parser, cliente)
    └── integration/              # Testes de integração (fluxo acadêmico, RBAC, certificados)
```

---

## 5. Guias e Documentação Complementar

* [Arquitetura e Engenharia de Software](docs/ARCHITECTURE.md)
* [Referência Completa da API REST, Webhooks e SSE](docs/API.md)
* [Integração Técnica com Acessilia Core e Toolbox](docs/CORE_INTEGRATION.md)
* [Guia de Acessibilidade e Conformidade (WCAG 2.2 AAA / LBI)](docs/ACCESSIBILITY.md)
* [Guia de Implantação e Operação em Produção](docs/DEPLOYMENT.md)

---

## 6. Licença e Direitos

Desenvolvido para apoio à inclusão acadêmica em conformidade com a legislação brasileira de acessibilidade.
