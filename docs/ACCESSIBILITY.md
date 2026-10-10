# Guia de Acessibilidade e Conformidade — WCAG 2.2 AAA & LBI

O **Acessilia Gestor** foi desenvolvido tendo a acessibilidade como requisito de primeira classe, atendendo integralmente aos critérios da **Lei Brasileira de Inclusão da Pessoa com Deficiência (Lei nº 13.146/2015)** e às diretrizes internacionais do **WCAG 2.2 (Web Content Accessibility Guidelines) em Nível AAA**.

---

## 1. Barra Rápida de Acessibilidade Visual (Toolbar Superior)

Localizada no cabeçalho fixo da aplicação, disponível em todas as telas:

* **Tamanho de Tipografia Ajustável:**
  * `A` (Padrão 16px): Escala padrão do sistema.
  * `A+` (Grande 18px): Escala expandida em 112,5%.
  * `A++` (Extragrande 20px): Escala expandida em 125%, projetada para usuários com baixa visão severa sem quebras de layout (*WCAG 1.4.4 Resize Text*).
* **Modos de Contraste Institucional:**
  * `🌓 Alto Contraste`: Fundo preto puro (`#000000`), textos e ícones em amarelo acessível (`#ffff00`) e bordas em ciano (`#00ffff`), superando a razão de contraste estrita de 7:1 (*WCAG 1.4.6 Contrast Enhanced*).
  * `🌙 Dark Slate`: Paleta noturna suave (`#0b1120` / `#1e293b`), ideal para pessoas com fotofobia ou fadiga visual.
* **Tipografia Amigável para Dislexia:**
  * `📖 Dislexia`: Aplica fonte adaptada com maior diferenciação entre caracteres espelhados (b/d, p/q), espaçamento entre letras aumentado (`0.05em`) e entrelinhas expandido (`1.8`), reduzindo saltos involuntários de leitura.
* **Régua de Leitura Virtual (Reading Guide):**
  * `📏 Régua` (Atalho `Alt + R`): Projeta uma guia de leitura semitransparente que acompanha a rolagem ou o mouse, facilitando o acompanhamento de linha para estudantes com TDAH ou dificuldades de foco.

---

## 2. Navegação por Teclado e Foco Visível

* **Skip Link (Salto para o Conteúdo):**
  * Primeiro elemento focável na tecla `Tab` (`WCAG 2.4.1 Bypass Blocks`). Pressionar `Enter` desloca o foco imediatamente para a tag `<main id="conteudo-principal">`.
* **Indicador de Foco Visível Reforçado (WCAG 2.4.7):**
  * Todos os botões, campos de entrada, links e elementos interativos possuem anel de foco de 3px com deslocamento (`outline-offset: 2px`), visível tanto em tema claro quanto em alto contraste.
* **Atalhos de Teclado Universais:**
  * Pressione `?` para abrir o modal acessível com a listagem completa de atalhos.
  * `Alt + 1`: Ir para o conteúdo principal.
  * `Alt + 2`: Ir para o menu lateral.
  * `Alt + R`: Ativar/desativar régua de leitura.
  * `Alt + C`: Alternar alto contraste.
  * `Esc`: Fechar modais, gaveta mobile e menus abertos.

---

## 3. Compatibilidade com Leitores de Tela (NVDA, JAWS, TalkBack)

* **Região de Anúncio Dinâmico (`aria-live="polite"`):**
  * O elemento `#aria-status-announcer` transmite mudanças de contexto (alterações de fonte, contraste, cópias de texto e avisos da fila) sem interromper a fala em andamento do usuário (*WCAG 4.1.3 Status Messages*).
* **Semântica HTML5 Rigorosa:**
  * Uso correto de landmarks (`<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>`).
  * Hierarquia estrita de cabeçalhos (`<h1>` único por página, seguido ordenadamente por `<h2>` e `<h3>`).
  * Tabelas com cabeçalhos declarados (`<th scope="col">`) e legendas explicativas.

---

## 4. Web Reader e Audiolivro Acessível

* **Leitor Web com Controles Tipográficos:**
  * O estudante pode alterar a tipografia da obra em tempo real (Fonte padrão vs. Dislexia, espaçamento 1.5x vs. 2.0x, esquemas de cores Amarelo sobre Preto e Ciano sobre Azul).
* **Player Nativo de Áudio com Atalhos de Teclado:**
  * `Espaço`: Reproduzir / Pausar.
  * `J`: Retroceder 5 segundos.
  * `L`: Avançar 5 segundos.
  * `[`: Diminuir velocidade em 0.25x.
  * `]`: Aumentar velocidade em 0.25x (até 2.5x para estudantes acostumados com alta cadência).
* **Síntese de Voz Integrada:**
  * Botão de leitura contínua com sintetizador Web Speech nativo.

---

## 5. Selo Acessilia e Certificação Digital com QR Code

Cada documento processado e revisado recebe um selo institucional com validação pública:
* **Código de Status Visual Duplo:** Ícone + texto descritivo (não depende exclusivamente de cor para transmitir informação — *WCAG 1.4.1 Use of Color*).
* **QR Code de Validação:** Aponta para `/certificados/:hash`, permitindo que docentes, discentes e auditores comprovem a conformidade do documento e os dados da homologação humana.
