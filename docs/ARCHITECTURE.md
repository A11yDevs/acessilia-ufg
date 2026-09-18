# Arquitetura e Engenharia do Sistema — Acessilia Gestor

Este documento consolida as decisões arquiteturais, o modelo de domínio e as correções de integridade implementadas com base no ciclo de revisão do GitHub (Issue #1).

---

## 1. Visão Geral da Arquitetura

O ecossistema Acessilia é dividido em dois módulos complementares e desacoplados:
1. **Acessilia Gestor (Node.js/Fastify/SQLite):** Painel administrativo, gestão de cursos, disciplinas, turmas, controle de acesso RBAC, integridade de sessões, auditoria, agendamento de liberação e certificação de acessibilidade.
2. **Acessilia Core (Python/FastAPI/IA):** Motor computacional especializado na extração de texto, geração de alt-text via visão computacional, síntese de voz e conversão em formatos acessíveis (WCAG 2.2 AAA / LBI).

---

## 2. Diagramas de Engenharia

### 2.1 Fluxo de Envio e Revisão (PlantUML)
Arquivo: [`docs/diagrams/sequence_submission.puml`](diagrams/sequence_submission.puml)

Descreve o ciclo de vida completo do material:
- Envio da versão v1 (ORIGINAL) pelo docente.
- Despacho assíncrono com idempotência estrita para o motor Core.
- Geração da versão v2 (PROCESSADO_BOT) via Webhook.
- Acesso antecipado do aluno (com banner informativo alertando sobre validação pendente).
- Homologação pela equipe de acessibilidade (NAI), gerando a versão v3 (REVISADO_HUMANO) e emitindo o Certificado Digital de Acessibilidade com QR Code.

### 2.2 Modelo de Entidades e Classes (PlantUML)
Arquivo: [`docs/diagrams/classes_domain.puml`](diagrams/classes_domain.puml)

Mapeia os três domínios principais:
- **Módulo Acadêmico:** Cursos, Departamentos, Disciplinas, Matrizes Curriculares e Turmas.
- **Módulo de Materiais e IA:** Materiais, Versões de Arquivos, Jobs de Processamento e Revisão de Alt-Text.
- **Módulo de Acessibilidade:** Solicitações discentes, Sessões de Revisão e Certificados Digitais.

---

## 3. Resolução de Apontamentos e Bugs (Issue #1)

| Item | Descrição | Correção Implementada |
|---|---|---|
| **§4.1** | Quebra dos filtros de busca e status na tabela de materiais | A busca manipulava índices frágeis (`td[0]`, `td[1]`, `td[4]`), que quebravam com a coluna de checkbox. A filtragem foi refatorada para ler atributos declarativos `data-title`, `data-subject` e `data-status` na `<tr>`. |
| **§4.2** | Botão "Visualizar Histórico" embutido dentro de form de bulk | O formulário de ações em lote envolvia todo o elemento `<table>`. O `<form id="form-bulk-actions">` foi extraído para fora da tabela e os checkboxes associados via atributo `form="form-bulk-actions"`. |
| **§4.3** | Layout apertado e ausência de classes responsivas | Estilos inline foram migrados para `components.css` (`.table-responsive`, `.data-table`, `.col-checkbox`, `.col-status`, `.col-actions`), com rótulo do botão sintetizado para "Visualizar". |
| **§4.5** | Falta de confirmação em ações em lote e falhas de acessibilidade em modais | Inclusão de diálogo de confirmação explícito antes do envio de aprovação/reprocessamento em lote, fechamento via tecla `Esc` e aprisionamento de foco (Focus Trap) nos modais. Colspan do estado vazio ajustado dinamicamente para 6 ou 7 colunas. |
| **§3.4** | Fallback de processamento automático mascarando falhas | Em ambientes de produção/desenvolvimento, falhas de conectividade com o Core agora marcam o material como `FALHA_PROCESSAMENTO`, reservando o mock exclusivamente para o ambiente de testes automatizados (`NODE_ENV === 'test'`). |
