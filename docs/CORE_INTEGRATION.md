# Integração Técnica: Acessilia Core & Toolbox

Este documento detalha como o **Acessilia Gestor** interage com o **Acessilia Core** (`backend/api`) e a **Acessilia Toolbox** (`acessilia_toolbox`), detalhando os contratos de envio, o mapeamento de etapas, o parser de metadados técnicos e os recursos de acessibilidade renderizados no Web Reader.

---

## 1. Visão Geral da Arquitetura Integrada

```
┌────────────────────────┐         Multipart POST /jobs         ┌────────────────────────┐
│    Acessilia Gestor    │ ───────────────────────────────────> │     Acessilia Core     │
│   (Node.js / Fastify)  │ <─────────────────────────────────── │   (Python / FastAPI)   │
│                        │       Webhook POST /webhooks         │                        │
└───────────┬────────────┘                                      └───────────┬────────────┘
            │                                                               │
            │ Server-Sent Events (SSE)                                      │ Execução de Capabilities
            ▼                                                               ▼
┌────────────────────────┐                                      ┌────────────────────────┐
│       Navegador        │                                      │   Acessilia Toolbox    │
│  (Web Reader / Cards)  │                                      │ (Docling, PDDL, Pure)  │
└────────────────────────┘                                      └────────────────────────┘
```

---

## 2. Contrato de Envio de Documentos (`POST /jobs`)

O cliente HTTP integrado ([src/integrations/bot-acess/client.js](../src/integrations/bot-acess/client.js)) comunica-se com a API do Core (`/api/v1/jobs`):

### Campos do Multipart:
* **`document_file`**: Arquivo binário enviado pelo docente (PDF, DOCX, etc.).
* **`file`**: Fallback do arquivo para compatibilidade com versões legadas.
* **`source`**: Identificador fixo `"gestor"`, permitindo rastreabilidade no Core.
* **`mode`**: Modo de verbosidade (`"normal"`).
* **`custom_prompt`**: Instruções adicionais opcionais (até 6.000 caracteres).

### Resposta Imediata do Core:
```json
{
  "task_id": "f5a89c1b",
  "position": 1,
  "message": "Arquivo na fila (Posição: 1)."
}
```

---

## 3. Acompanhamento de Etapas e Barra de Progresso Real (SSE)

O Core processa o documento através de múltiplos estágios. O Gestor monitora ou recebe essas etapas e as transmite aos usuários via Server-Sent Events (`/api/v1/notifications/stream`):

| Etapa do Core | Percentual Estimado | Descrição Exibida no Gestor |
|---|---|---|
| `STAGE_ENQUEUED_WAITING` | 5% – 15% | Aguardando vaga na fila de processamento |
| `STAGE_ANALYZING_FILE` | 20% – 35% | Análise de layout com Docling e segmentação |
| `STAGE_PROCESSING_WITH_AI` | 40% – 65% | Execução de plano PDDL e geração de audiodescrições |
| `STAGE_EXPORTING_TXT` | 75% | Geração do texto estruturado acessível |
| `STAGE_EXPORTING_HTML` | 85% | Geração do HTML semântico com metadados |
| `STAGE_GENERATING_AUDIO` | 90% – 95% | Síntese de voz e audiolivro em MP3 |
| `STAGE_PROCESSING_COMPLETED` | 100% | Concluído — Recarregamento automático da interface |

---

## 4. Parser de Metadados Técnicos do Core (`<aside class="meta">`)

Ao final do documento HTML gerado, o Core anexa um bloco técnico com informações sobre a execução do Docling e do planejador PDDL:

```html
<aside class="meta">
  <h2>Metadados técnicos</h2>
  <p>{'pipeline_engine': 'pddl', 'pddl_manifest_id': 'manifest-6f5e19b2...', 'page_count': 1, 'blocks': [...]}</p>
</aside>
```

O utilitário [src/utils/meta-parser.js](../src/utils/meta-parser.js) analisa esse bloco:
1. Converte tipos primitivos do Python (`None` $\to$ `null`, `True` $\to$ `true`, `False` $\to$ `false`) para JSON válido.
2. Extrai com segurança:
   * **`pipelineEngine`**: Motor de planejamento utilizado (`PDDL`).
   * **`totalBlocks`**: Total de blocos identificados pelo Docling.
   * **`imagesCount`**: Quantidade de elementos visuais descritos por IA.
   * **`estimatedReadingTimeMinutes`**: Estimativa de tempo de leitura para o estudante.
3. Alimenta o painel de **Metadados Técnicos do Motor Acessilia Core** na tela de detalhes do material.

---

## 5. Renderização de Audiodescrição (`<figure><img src="" alt="...">`)

### O Padrão do Core:
O Core não embute arquivos gráficos pesados para economizar largura de banda e priorizar tecnologias assistivas, gerando imagens com `src=""` e a descrição completa no `alt`:

```html
<figure id="element-000024">
  <img alt="A imagem apresenta um logotipo dividido em duas partes..." src="">
</figure>
```

### O Tratamento no Gestor:
O Gestor intercepta essas ocorrências e as renderiza como **Cards de Audiodescrição Acessíveis** (`.a11y-audiodesc-card`):
* **Ícone e Cabeçalho:** Tag destacada `🖼️ Audiodescrição de Imagem Original`.
* **Citação Textual:** Texto completo da audiodescrição visível com alto contraste.
* **Botão `🔊 Ouvir Descrição`:** Executa a leitura em voz alta via sintetizador do navegador (`window.speakAudiodesc`).
* **Botão `📋 Copiar Texto`:** Permite copiar o texto da audiodescrição para uso acadêmico.
* **Semântica:** Preserva `role="region"` e `aria-label="Audiodescrição de elemento visual"` para leitores de tela.

---

## 6. Fórmulas Matemáticas Acessíveis (Toolbox `math.verbalize`)

Integrando com a capability `math.verbalize` da Acessilia Toolbox, o Web Reader do Gestor inclui o componente `.a11y-math-card`:
* **Fórmula Visual:** Renderizada em LaTeX formatado com tipografia matemática dedicada.
* **Verbalização em Português:** Bloco de texto com a leitura falada por extenso gerada pela Toolbox (ex.: *"A função f de x é igual à integral definida de zero a infinito..."*).
* **Botão `🔊 Ouvir Equação Falada`:** Leitura fonética pausada em cadência `0.90x` otimizada para notações científicas.
