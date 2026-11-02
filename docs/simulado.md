# Área de simulado e estudo adaptativo

Status: **oculta, em validação local.** Liga só para as contas de `SIMULADO_ATIVA_PARA` e, enquanto
`SIMULADO_SO_LOCAL` estiver ligado (padrão), só em `localhost`. Fora disso, o menu não mostra nada e
`/simulado`, `/api/simulado/*` e `/api/admin/simulado/*` respondem 404.

A página (`/simulado`, `/simulado.html`) e o JS e o CSS dela exigem também o cookie `app_simulado`, gravado em `/api/recursos` para quem
está liberado. O pedido da página não leva a sessão (o token fica no navegador), então o cookie só decide se ela é entregue; as
permissões continuam nas APIs. Com `SIMULADO_ATIVA_PARA=*`, o cookie não é exigido.

## O que o aluno faz

1. **Envia documentos** (PDF, DOCX, TXT; imagem só com um provedor de IA com visão) em *Documentos*.
   O portal extrai o texto, verifica se é uma prova (ver abaixo) e tira os tópicos de estudo.
2. **Pede um resumo** de cada documento: resumo, pontos principais, termos-chave, tópicos e habilidades.
3. **Faz um simulado**: 10 questões de múltipla escolha (a–e), no formato das provas do aluno (que são só de
   alternativas), montadas a partir dos documentos, com correção, feedback por questão (com o trecho do material de
   referência) e nota por tópico. Não há dissertativas no simulado (o código ainda sabe gerar e corrigir, se um dia o
   curso tiver provas discursivas: `discursivas` no corpo de `POST /api/simulado/simulados`).
4. **Vê os pontos a melhorar**: domínio estimado por tópico, recomendação, próxima revisão e "o que reler"
   (trechos das questões que errou).
5. **Revisa com flashcards** (repetição espaçada) e **quiz relâmpago** (5 objetivas dos tópicos fracos
   ou vencidos, correção na hora).

## Desenho

```
public/simulado.html + js/simulado.js + css/simulado.css     tela própria em /simulado
public/js/app.js        mostrarSimulado(): injeta "Simulado" no menu se /api/recursos devolve simulado: true
server/index.js         monta as rotas, flag em /api/recursos, página /simulado
server/simulado/
  index.js        flag, portão (404), schema csu_sim_*, rotas do aluno e do admin
  extrair.js      PDF (pdfjs-dist), DOCX (zip + XML, sem dependência nova), TXT (UTF-8/Latin-1), imagem via IA
  deteccao.js     heurística de prova + combinação com o LLM
  llm.js          provedor: stub determinístico | anthropic (Claude, SDK oficial)
  adaptativo.js   domínio por tópico, repetição espaçada, distribuição das questões, recomendações
  texto.js        utilidades de texto em português (termos, frases, raízes)
```

### Tabelas (criadas sob demanda, `CREATE TABLE IF NOT EXISTS`, no primeiro uso por aluno liberado)

| Tabela | Conteúdo |
| --- | --- |
| `csu_sim_documentos` | nome, tipo, tamanho, sha256, **texto extraído** (não o arquivo), status `ok`/`pendente`/`bloqueado`, `revisao`, detecção (JSON), resumo |
| `csu_sim_topicos` | tópicos e habilidades por documento, com os trechos que os sustentam |
| `csu_sim_desempenho` | por tópico: domínio (0–1), tentativas, fator de facilidade, intervalo, próxima revisão |
| `csu_sim_simulados` | questões (com gabarito, só no servidor), respostas, resultado, nota; `tipo` = simulado ou relampago |
| `csu_sim_flashcards` | frente, verso e estado da repetição espaçada |

Tudo com `aluno_id` e `ON DELETE CASCADE`. Cada consulta filtra pelo aluno da sessão; outro aluno recebe 404.

### API (todas exigem sessão de aluno liberado)

Flag desligada, fora de localhost ou aluno fora da lista: 404. Com a flag ligada, sessão vencida ou ausente: 401
("Sua sessão expirou"), e a tela leva ao login.

| Método e rota | O que faz |
| --- | --- |
| `GET /api/simulado/estado` | documentos, últimos simulados, contagem de flashcards, provedor |
| `POST /api/simulado/documentos` | upload: corpo bruto, nome em `X-Nome-Arquivo` (até 10 MB, 30/dia, 30 no total) |
| `POST /api/simulado/documentos/:id/confirmar` | `{ material_estudo: true \| false }` para confiança média |
| `DELETE /api/simulado/documentos/:id` | apaga documento, tópicos e flashcards dele |
| `POST /api/simulado/documentos/:id/resumo` | resumo (guardado; `{ refazer: true }` refaz) |
| `POST /api/simulado/simulados` | `{ tipo: 'simulado' \| 'relampago', objetivas? (padrão 10), discursivas? (padrão 0) }` |
| `POST /api/simulado/simulados/:id/conferir` | quiz relâmpago: confere uma questão |
| `POST /api/simulado/simulados/:id/corrigir` | corrige, grava nota e atualiza o desempenho por tópico |
| `GET /api/simulado/painel` | pontos a melhorar, todos os tópicos, o que reler |
| `POST /api/simulado/flashcards/gerar`, `GET .../hoje`, `POST .../:id/revisar` | flashcards (`nota` 0 errei, 1 difícil, 2 bom, 3 fácil) |
| `GET /api/admin/simulado/deteccoes`, `POST .../:id/revisado` | admin: detecções de prova e arquivos marcados para revisão |

### Ensino adaptativo

- **Domínio por tópico**: média móvel da nota no tópico (`0,6 × anterior + 0,4 × nova`).
- **Repetição espaçada** (SM-2 simplificado): nota abaixo de 60% volta em 1 dia; acima, 1 → 3 → intervalo × fator.
  Flashcard com "Errei" volta em 10 minutos.
- **Peso no próximo simulado**: `(1 − domínio) × 2 + 0,2`, mais 1 se a revisão venceu; tópico nunca avaliado = 1,5.
  As questões são repartidas pelo peso (maiores restos); se um tópico não rende questões suficientes, os outros completam,
  do mais fraco ao mais forte. No teste local, depois de tirar 0 em Divisão celular, o simulado seguinte trouxe 6 de 10 questões desse tópico.
- **Recomendação**: abaixo de 40%, reler o resumo, revisar flashcards e fazer o quiz; abaixo de 70%, flashcards e quiz até a
  próxima revisão; acima, só revisar quando vencer.
- Tópicos de mesmo nome em documentos diferentes são **unidos** (o histórico continua um só).

### Rastreio (sem CRM)

- **A área de simulado não fala com o CRM** (decisão do usuário em 31/10): a tela não carrega o chat do Bwipo e não chama
  `Rastreio.contexto`, `Rastreio.track`, `identify` nem `setContext`. O widget do chat continua nas outras telas, como antes.
- Os eventos vão só para o nosso servidor, por `Rastreio.registrar` (fila de `/api/eventos` -> `csu_eventos`), e só para contas
  com o rastreio liberado (`RASTREIO_LIBERADO_PARA`). Aparecem no percurso do aluno no admin (Acompanhamento).
- Eventos: `tela_aberta`, `simulado_aba`, `simulado_documento_enviado`, `simulado_documento_confirmar`, `simulado_documento_bloqueado`,
  `simulado_resumo`, `simulado_gerado`, `simulado_corrigido` (nota), `simulado_relampago_*`, `flashcard_revisado`, `flashcards_criados`,
  `simulado_pontos_melhorar` e `simulado_dificuldade` (tópico com nota abaixo de 6, até 3 por correção).
- As detecções de prova são gravadas pelo servidor (`simulado_deteccao_prova`, `simulado_deteccao_confirmacao`), com ou sem rastreio liberado.
- Nada do que o aluno digita nas respostas vai para o rastreio.

## Detecção de prova do próprio aluno

O aluno não pode enviar a própria prova. A detecção roda **no upload**, antes de guardar o texto.

### Sinais da heurística (texto normalizado, sem acento)

| Sinal | Pontos |
| --- | --- |
| Cabeçalho de prova ou avaliação no início (prova, avaliação, exame, AV1/AP1/NP1, recuperação…) | 2 |
| Campos de identificação: nome, RA/RGM/matrícula, turma/curso, data em branco, professor | 1 (1 campo), 2,5 (2), 3,5 (3+) |
| "Valor da questão", "(1,0 ponto)", "peso:" | 2 |
| Campo de nota | 1 |
| Questões numeradas com alternativas a–e | 1,5 (3+ questões e 8+ alternativas), 2 (5+ e 12+) |
| Gabarito, folha de respostas, cartão-resposta | 1,5 |
| Espaço para assinatura | 2 |
| Instruções de prova (boa prova, não é permitido, sem consulta, duração da prova…) | 1,5 |
| Marcas de resposta ou correção ("(X)", "nota obtida", "acertos: 7") | 1 |

Confiança da heurística = `soma ÷ 12` (máximo 1). Texto longo (mais de 25 mil caracteres, como uma apostila) multiplica a soma por 0,6.

### Classificação por LLM

Com o provedor `anthropic`, o modelo recebe os primeiros 20 mil caracteres e devolve `eh_prova`, `confianca` e `motivo` (JSON com schema).
Confiança final = `0,4 × heurística + 0,6 × LLM`. Se os dois discordam muito (diferença acima de 0,6), a decisão fica no máximo
em **média**: nenhum dos dois bloqueia sozinho. Com o stub, vale só a heurística (o stub não finge ser um segundo classificador).

### Decisão

| Confiança | O que acontece |
| --- | --- |
| **Alta** (≥ 0,70) | Bloqueia com mensagem gentil. O texto **não** é guardado, só o nome, o hash e os sinais (para o admin e para recusar o mesmo arquivo de novo). |
| **Média** (0,40 a 0,69) | Pede ao aluno que confirme que é material de estudo. Se confirmar, o arquivo segue e fica `revisao = true`; se não, é apagado. |
| **Baixa** (< 0,40) | Segue normalmente. |

Cada detecção média ou alta vira evento em `csu_eventos` (`simulado_deteccao_prova`, com nível, confiança, fonte, decisão e sinais),
e a resposta do aluno vira `simulado_deteccao_confirmacao`. Os eventos aparecem no percurso do aluno no admin (Acompanhamento) e a
lista completa sai em `GET /api/admin/simulado/deteccoes`.

Nos testes locais: a prova bimestral (TXT e PDF) foi bloqueada com confiança 1; uma prova antiga "usada para treinar" caiu em média
e pediu confirmação; a lista de exercícios de apoio (nome em branco, alternativas e "gabarito no fim") ficou em 0,33 e passou; a apostila ficou em 0.

### Limites conhecidos

- **Não sabe de quem é a prova.** Uma prova em branco de outro semestre, usada para estudar, tem os mesmos sinais de uma prova aplicada
  e pode ser bloqueada ou cair em média. Por isso a faixa média pede confirmação em vez de bloquear.
- **Fácil de contornar por quem quer**: basta copiar as questões para um TXT sem cabeçalho, campos e valores. A detecção serve para
  orientar e registrar, não para impedir quem está decidido a burlar. A defesa real é o desenho: o simulado gera questões **novas** a partir
  do material e não "resolve" a prova enviada.
- **PDF escaneado ou foto**: sem texto selecionável, não há o que analisar. Sem provedor com visão, o upload é recusado ("envie uma versão
  com texto"). Com visão, a transcrição pode perder campos ou marcas à mão.
- **Listas de exercícios e simulados de cursinho** têm questões numeradas, alternativas e às vezes gabarito: podem cair em média.
- Texto em **outro idioma** ou layout em colunas (PDF) reduz os acertos da heurística (os padrões são em português).
- O LLM pode errar e é sensível ao que está no documento; o texto é tratado como dado (o prompt manda ignorar instruções dentro dele),
  e a decisão final ainda passa pela heurística.
- Os limiares (0,40 e 0,70) e os pesos são estimativas iniciais. Ajustar com os casos reais revisados pela equipe.

## Provedor de IA

- **Sem chave (hoje)**: stub determinístico. Antes de tudo limpa o texto: tira cabeçalho e rodapé repetidos, carimbo de data da
  impressão, marca d'água e avisos de site ("Impresso por…", cookies, direitos autorais), créditos de figura, links e e-mails, e junta as
  linhas que o PDF quebrou no meio da frase. Resumo extrativo (frases com mais termos frequentes). Tópicos pelo **sumário** em tópicos do
  Material Teórico ("• Princípios de Sustentabilidade"; Introdução e Síntese ficam de fora), senão pelos títulos numerados ou em maiúsculas,
  senão pelos termos mais frequentes e questões de múltipla escolha com 5 alternativas em dois formatos: lacuna (o termo certo e 4
  distratores do próprio vocabulário) e "assinale a alternativa correta" (uma frase do material e 4 frases com um termo trocado).
  Funciona para validar o fluxo; a qualidade pedagógica é limitada (às vezes um distrator é de outra classe de palavra ou fácil demais).
  Com o Claude, as questões variam entre "assinale a correta", "assinale a incorreta" e aplicação do conceito.
- **Anthropic (Claude)**: `npm install @anthropic-ai/sdk` e `ANTHROPIC_API_KEY` no `.env` (opcionalmente `SIMULADO_LLM=anthropic`
  e `SIMULADO_LLM_MODELO`, padrão `claude-opus-5-5`). Saída em JSON com schema, fallback automático em recusa, esforço baixo para
  classificar e corrigir, médio para resumir e gerar questões. Liga também a leitura de imagens.
- Custo: cada upload faz 2 chamadas (classificação e tópicos); resumo, simulado (uma por tópico), correção de discursiva e flashcards
  fazem chamadas sob demanda. Resumo e tópicos ficam guardados.

## Em produção só para o aluno de teste

O código está na `main` desligado por padrão: sem `SIMULADO_ATIVA_PARA` o menu não mostra nada e `/simulado`
e `/api/simulado/*` respondem 404; com `SIMULADO_SO_LOCAL` em `true` (o padrão) também é 404 fora do localhost.
Para abrir só para o aluno de teste, no Environment do EasyPanel:

```
SIMULADO_ATIVA_PARA=<o mesmo RGM ou e-mail de AJUDA_ATIVA_PARA>
SIMULADO_SO_LOCAL=false
```

Sem `SIMULADO_LLM`, roda o modo de demonstração (sem custo de IA). As tabelas `csu_sim_*` são criadas no banco de
produção na primeira chamada de um aluno liberado. Para desligar, basta apagar `SIMULADO_ATIVA_PARA`.

## Antes de abrir para mais alunos

1. Escolher e configurar a chave do provedor (e instalar o SDK); rever os prompts com 10 a 20 documentos reais.
2. ~~Mover `pdfjs-dist` para `dependencies`~~ (feito: o Dockerfile roda `npm ci --omit=dev`).
3. Criar as tabelas no banco de produção (sobem sozinhas no primeiro uso, mas vale rodar antes em janela calma).
4. Definir retenção dos textos (hoje ficam até o aluno apagar) e incluir a área na política de privacidade.
5. Tela no admin para as detecções (hoje há a API e os eventos no percurso do aluno).
6. `SIMULADO_SO_LOCAL=false` e `SIMULADO_ATIVA_PARA` com a lista do piloto.

## Outras formas de aprender (sugestões priorizadas)

Implementados agora: **flashcards com repetição espaçada** e **quiz relâmpago**.

| # | Formato | Por que | Custo |
| --- | --- | --- | --- |
| 1 | **Glossário** dos termos-chave com definição tirada do material | Quase de graça: os termos já são extraídos; ajuda calouros com o vocabulário | Muito baixo |
| 2 | **Tutor socrático restrito aos documentos** (pergunta de volta em vez de dar a resposta) | Maior ganho de aprendizagem; reaproveita tópicos e trechos; conversa fica no chat da tela | Médio (LLM por mensagem) |
| 3 | **"Ensine de volta" (Feynman)**: o aluno explica o tópico e recebe o que faltou | Reaproveita a correção de discursiva já pronta | Baixo |
| 4 | **Plano de estudos com calendário** a partir das próximas revisões e da data da prova | Os dados já existem (`proxima_revisao`); integra com Meu semestre | Baixo |
| 5 | **Casos práticos**: situação-problema aplicando o tópico | Bom para cursos aplicados (gestão, saúde, direito) | Médio |
| 6 | **Mapa mental** dos tópicos e relações (SVG gerado no servidor) | Visual, bom para revisão rápida | Médio |
| 7 | **Resumo em áudio** (ElevenLabs, chave já usada nos vídeos) | Estudo no ônibus; acessibilidade | Médio a alto (custo por minuto de áudio) |

## Como testar localmente

1. `.env` da worktree com `PORT` livre e `SIMULADO_ATIVA_PARA` igual a `AJUDA_ATIVA_PARA` (o aluno de teste).
2. `npm start` e abrir `http://localhost:<PORT>/login` com o aluno de teste: o menu ganha "Simulado".
3. *Documentos*: enviar uma apostila (passa), uma prova com nome/RA/valor/assinatura (bloqueia), uma prova antiga "de treino" (pede confirmação).
4. *Ver resumo*; *Simulado* › Gerar, responder e corrigir; *Pontos a melhorar*; *Flashcards* › Criar; *Quiz relâmpago*.
5. Com outro aluno, ou com `SIMULADO_ATIVA_PARA` vazio: nenhum link, e `/simulado` e `/api/simulado/estado` dão 404.
