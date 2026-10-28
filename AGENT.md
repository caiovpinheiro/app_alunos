# AGENT.md — Registro de Decisões

## Fluxo de git (obrigatório)

- Trabalhe **somente em `main`**. Commit e push direto nela.
- **Nunca** crie branch, PR, fork ou `cursor/...-f9ae` neste repositório.
- Push em `main` dispara `.github/workflows/deploy.yml`: publica `ghcr.io/caiovpinheiro/app_alunos:latest` e chama o webhook do EasyPanel (`secrets.EASYPANEL_DEPLOY_APP`).
- Não invente outro fluxo de deploy (n8n, branch de homologação, etc.) sem pedido explícito.

### 2026-10-28 - Pedido de ajuda no "Travei" e na dificuldade (AJUDA_ATIVA_PARA)

**Decisão**
- `public/js/dificuldade.js` oferece no próprio lugar "Quer falar com a equipe agora?" (nunca abre o chat sozinho). Gatilhos: "Travei" (módulo ou parte), 2 erros na mesma pergunta, 3 pausas no mesmo vídeo antes de 90%, 2 buscas diferentes sem resultado na Central em 10 min, erro técnico no certificado (o 422 "faltam módulos" não conta), 4 min parado no módulo. Nada com vídeo tocando; no máximo 2 ofertas automáticas por sessão; "Agora não" cala a oferta por 24 h (localStorage); com pedido aberto no mesmo módulo, mostra o protocolo.
- Ao aceitar: `POST /api/ajuda/pedidos` grava `csu_pedidos_ajuda` (protocolo `AJ-XXXX`, origem, módulo/parte/pergunta e o contexto montado no servidor a partir do banco: onde, opções erradas marcadas, vídeo, progresso, aparelho e os últimos 10 eventos se houver rastreio). Um pedido aberto por módulo (ou por origem) em 24 h. O aluno segue pelo WhatsApp do polo com a mensagem e o protocolo; quando o widget do Bwipo tiver `open({ message })` com `capabilities.prefill`, abre o chat. "Falar com a equipe" do painel de Ajuda também cria o pedido.
- Admin: pedidos no topo de Quem contatar (o que a equipe precisa saber, Em atendimento, Resolvido, que também grava em `csu_followups`), ação "Responder N pedidos" na Visão geral e link direto `/admin#acompanhamento/aluno/{id}` que abre o percurso.
- CRM: com `PEDIDO_AJUDA_WEBHOOK_URL` (e `PEDIDO_AJUDA_WEBHOOK_SECRET`), cada pedido vai assinado (`X-Signature = sha256 HMAC de "timestamp.corpo"`, `Idempotency-Key` = protocolo); falhas são reenviadas a cada 10 min, até 5 vezes em 48 h. Contrato em `docs/integracao/bwipo-eventos.md`.
- Corrigido: a mensagem de "Travou na Aula Inaugural" usava o primeiro módulo em aberto; agora usa o módulo onde o aluno tocou em "Travei" (`nivel_travei`).

**Impacto**
- Desligado até `AJUDA_ATIVA_PARA` existir no Environment (RGM/e-mail; `*` = todos). Sem `RASTREIO_LIBERADO_PARA`, o pedido vai sem a linha do tempo. Nada digitado em formulários entra no pacote; termos de busca com 6+ dígitos são mascarados.

### 2026-10-28 - Central de ajuda por tema e visual novo das telas do aluno

**Decisão**
- Central (`/tutoriais`) organizada em 8 temas (`server/assets/central/temas.json`: ordem da jornada, cada vídeo e cada pergunta em um tema só, `curto` para a faixa fixa). `/api/central` só ganhou campos (`tema`, `ordem`, `temas`, `comece`); a Central congelada continua com a mesma resposta. Tela: "Comece por aqui" (5 passos, só para quem ainda não começou a Aula), faixa de temas fixa, índice, uma seção por tema (4 vídeos, 3 no celular, e 3 dúvidas, com "ver todos"), busca agrupada por tema, "A seguir neste tema" no player e link direto `/tutoriais#pagamentos`.
- `videos.json`: `tut_dp` passou a "Rematrícula" e `tut_extensao` a "Horas complementares"; os 4 vídeos de primeiro acesso viraram a série `acesso` (Parte 1 a 4).
- Telas do aluno no design system (`public/css/ds.css`, carregado por último): Atkinson Hyperlegible Next, azul-marinho, amarelo só na ação principal, superfícies planas, troca de tela sem desfoque. Só CSS e marcação: ids, `data-*` e classes do JS iguais. Meu semestre e Aula Inaugural só receberam cores e fonte novas (ajuste fino pendente).

**Impacto**
- Vale para quem vê a versão nova (`VERSAO_NOVA_PARA` / `VERSAO_NOVA_DESDE`); `public-antigo/` não mudou.

### 2026-10-28 - Admin: Visão geral (Bom / Regular / Ruim) e visual novo

**Decisão**
- Aba nova **Visão geral** (`#painel`), que passa a ser a primeira do admin. `GET /api/admin/painel?dias=` (`server/painel.js`) só lê o que já existe (acompanhamento, funil, Aula Inaugural, joinhas, buscas sem resultado) e devolve: 10 indicadores com faixa Bom / Regular / Ruim ("Poucos dados" com menos de 5 alunos na conta), a lista "O que fazer agora" em ordem (primeiro o que impede o aluno de seguir, depois o conteúdo a melhorar) e a **situação** de cada aluno. Cada ação abre Quem contatar já filtrado. O funil por dia de matrícula saiu de Quem contatar e foi para cá.
- **Situação do aluno** (uma só, nesta ordem): certificado emitido, nunca entrou, travou na Aula ("Travei" sem concluir), sumiu (N dias sem acessar, padrão 7), parou a Aula (sinal `parou_trilha`), concluiu sem certificado, entrou sem começar a Aula, fazendo a Aula. `GET /api/admin/acompanhamento` devolve `situacao`, `certificado_emitido` e `joinhas` (👍/👎 dados pelo aluno) em cada linha, aceita `?situacao=` e o catálogo `situacoes`; o CSV ganhou situação, "Travei" e joinhas.
- **Faixas editáveis** em Configurações › Faixas da Visão geral (`GET/PUT /api/admin/painel/faixas`, `{ reset: true }` volta ao padrão). Ficam em `csu_acomp_config.config.faixas`, na mesma linha das regras dos sinais: salvar ou restaurar as regras não mexe nas faixas, e vice-versa. Limites fora de ordem são trocados; iguais voltam ao padrão.
- Quem contatar: cartão do aluno com situação e o que fazer, jornada (entrou, Aula x de 7, certificado), "Travei" e módulo, joinhas, acessos, vídeos e último contato; filtro "Mostrar" também por situação.
- Visual do admin no design system novo (`public/css/ds.css` com os tokens, `ds-admin.css`, `ds-painel.css`): fonte Atkinson Hyperlegible Next, azul-marinho da marca, superfícies planas, menu lateral com marcador amarelo. Só CSS e marcação: ids, `data-*` e classes usadas pelo JS continuam iguais.

**Contexto**
- Pedido do usuário: um admin que oriente a condução, com o que está bom, regular e ruim, o que melhorar e a situação de cada aluno (Travei, joinhas, acessos, sem acesso).
- As telas do aluno com o visual novo (`index.html` carregando `ds.css`) ficaram de fora desta publicação; o `ds.css` vai junto porque o admin usa os tokens, mas só o admin o carrega.

**Impacto**
- Os padrões das faixas (ex.: entraram no portal, Bom a partir de 80% e Regular a partir de 60%) são estimativas, não metas do polo: ajustar em Configurações.
- A Visão geral roda as mesmas consultas das abas Aula Inaugural e Uso juntas; se ficar lenta com a base real, guardar o resultado em cache por alguns minutos.

### 2026-10-20 - Ajustes de conteúdo pedidos pela equipe acadêmica

**Decisão**
- Declaração e Histórico: **Emissão de Documentos** (Área do Aluno). CAA On-line só para os outros pedidos. Pergunta 1 do Nível 2 trocada (a resposta certa continua no índice 1 de `opts`).
- Provas: exceções de **junho** (abre em fevereiro, prova no fim de maio) e **dezembro** (abre em agosto, prova no fim de novembro).
- Temas Transversais: quando obrigatória no curso, as horas **não contam** como complementares. Pergunta 2 do Nível 6 trocada (a resposta certa continua no índice 2, como na pergunta antiga).
- DP e adaptação: introdução no Nível 5, aviso no Nível 4, FAQ `dp-adaptacao` (grupo Provas e notas) e glossário.

**Contexto**
- Revisão da equipe em 20/10, registrada em `docs/qa/qa-calouro-2026-10-17.md` ("Revisão da equipe acadêmica").

**Impacto**
- Respostas já gravadas em `csu_trilha_progresso` para as duas perguntas trocadas continuam valendo (a correção é por índice e o índice certo não mudou).
- Os vídeos `aula/cap_10`, `videos/nivel6`, `aula/cap_08` ainda falam o contrário no áudio/tela: precisam de regravação (lista no relatório de QA).

### 2026-10-17 - Rastreio do aluno para o chat (Bwipo)

**Decisão**
- `public/js/rastreio.js` (`window.Rastreio`) registra o que o aluno faz e envia ao widget do Bwipo por `BwipoWebchat.identify(...)` e `BwipoWebchat.track(nome, dados, { important, at })`. Só liga para quem recebe `webchat` em `/api/recursos` (mesma lista `WEBCHAT_LIBERADO_PARA`); para os outros, `track()` não faz nada.
- Enquanto o widget não expõe `identify/track`, os eventos ficam numa fila em memória (até 200) e são enviados quando ele estiver pronto (confere a cada 2 s por 2 min). `Rastreio.debug()` no console mostra estado e fila.
- `/api/recursos` devolve `webchat.identity`: RGM (`external_id`), nome, e-mail, curso/polo (`csu_alunos`) e `user_hash = HMAC-SHA256(WEBCHAT_IDENTITY_SECRET, RGM)` em hex (`server/webchat.js`). Sem o segredo, `user_hash` vem `null` e o Bwipo deve tratar a identidade como não verificada.
- Eventos: `tela_aberta`, `trilha_nivel_aberto`, `trilha_video_assistido`, `trilha_video_pulado`, `trilha_travei` (importante), `trilha_resposta`, `trilha_nivel_concluido`, `trilha_tarefa`, `central_busca`, `central_busca_sem_resultado` (importante), `faq_aberta` (só clique do aluno), `central_video`, `aula_capitulo`, `certificado_gerado`, `certificado_erro` (importante), `aviso_lido`, `whatsapp_clicado`. Os importantes viram nota interna na conversa; o resto vai para o painel "Atividade no portal".

**Contexto**
- Pedido: "trackear tudo o que o aluno faz e enviar para o chat". O `embed.js` atual do Bwipo só tem `open/close/toggle`; o contrato do que falta no Bwipo está em `docs/integracao/bwipo-eventos.md` (o crm1 está sendo construído em outra sessão).

**Alternativas descartadas**
- Postar eventos como mensagens do aluno no chat (o aluno veria e a conversa ficaria poluída).
- Guardar os eventos no Postgres do portal e o Bwipo buscar por RGM (exigiria API autenticada portal→CRM e atrasaria o contexto).
- `identify` sem assinatura (qualquer um no console poderia se passar por outro RGM).

**Impacto**
- Nada aparece no inbox até o Bwipo implementar `identify/track` + `/api/public/webchat/events` + painel. Até lá, os eventos ficam na fila do navegador e se perdem ao fechar a página.
- Para verificar a identidade: `WEBCHAT_IDENTITY_SECRET` no EasyPanel = `identitySecret` do canal no Bwipo.
- LGPD: é rastreamento ligado ao RGM; citar na política de privacidade antes de `WEBCHAT_LIBERADO_PARA=*`.

### 2026-10-17 - Chat do CRM (webchat) no portal, só para contas de teste

**Decisão**
- O script do webchat do CRM (`embed.js` + `data-key`) **não fica no HTML**. `GET /api/recursos` devolve `webchat: { src, key }` só para as contas em `WEBCHAT_LIBERADO_PARA` (Environment do EasyPanel): RGM ou e-mail, separados por vírgula. `*` = todos. **Vazio = ninguém** (padrão seguro, igual à trilha). Quem não está na lista recebe `webchat: null` e nada é carregado.
- `app.js` monta a tag `<script async src data-key>` uma vez, depois do login, a partir desse retorno (`server/webchat.js`). No logout, se o chat estava na página, recarrega em `/login` (o widget não tem como ser descarregado).
- `WEBCHAT_EMBED_URL` e `WEBCHAT_KEY` (o `data-key` do embed) vêm **só** do Environment do EasyPanel; não há valor padrão no código. Sem os dois, o chat não carrega.

**Contexto**
- Pedido: colocar o chat no site, mas só o aluno de teste deve ver. O CRM só aceita ser embutido em `app.cruzeiroead.com.br` (CSP `frame-ancestors`), então em `localhost` o script carrega mas o widget não abre; o teste real é em produção.

**Impacto**
- Para ligar: no EasyPanel, `WEBCHAT_EMBED_URL` (URL do `embed.js`), `WEBCHAT_KEY` (o `data-key`) e `WEBCHAT_LIBERADO_PARA=<RGM ou e-mail do aluno de teste>`, e reiniciar. Para todos: `*`. Para desligar: apagar a variável.

### 2026-10-17 - QA do calouro: painel novo, Central mais larga, bordas corrigidas

**Decisão**
- Painel inicial (`/inicio`) refeito na identidade da Trilha (azul-marinho + amarelo, Poppins/Atkinson), em `public/css/painel.css`: recepção com o próximo passo (trilha ou próximo prazo), 4 atalhos, "Próximas datas" (uma por dia, mensalidade do dia 25 sempre presente), avisos curtos e rodapé com o WhatsApp do polo. O card "Aula Inaugural" tem **Assistir** (abre a Central já na aula) e **Gerar certificado**.
- Telas de Tutoriais/Central, Trilha e painel vão até 1440px. Na Central, o FAQ virou menu de assuntos + respostas (uma aberta por vez; na busca, mostra tudo). Na Trilha, em telas largas, vídeo e resumo ficam lado a lado e as perguntas em duas colunas (`.lvpair` em `trilha.js`).
- Login: explica que o acesso é criado automaticamente **em até 2 dias úteis** depois da matrícula (RGM + senha inicial Nome123@), tem **Esqueci minha senha** (abre o WhatsApp acadêmico padrão via `GET /api/atendimento/padrao`, sem login) e "Criar acesso agora" para quem se matriculou há pouco e ainda não está no relatório. Erro 401 explica a senha inicial.
- `POST /api/auth/register`, com `MATRICULADOS_*` configurado: RGM que está no relatório com matrícula **inativa** (cancelada, trancada...) é recusado; RGM que **ainda não está** no relatório pode criar o acesso (resposta traz `cadastro_pendente: true` e o painel avisa que curso, polo e certificado chegam em até 2 dias úteis); RGM ativo já grava curso/polo. Sem a base, segue como antes. (`matriculados.lookupByIdentifier` consulta sem filtrar situação.)
- Certificado sem curso/polo: a mensagem diz o próximo passo e traz o botão do WhatsApp.
- WhatsApp: fallback com DDD (`11915184535`); número com 8–9 dígitos ganha `11` em `toWaNumber`. Mensagem sem "polo não informado".
- Conteúdo: links do Duda e do Authenticator (lojas), da Área do Aluno e do AVA na Trilha, nas tarefas e no FAQ; tarefa da 1ª mensalidade corrigida (desconto total até o 25); FAQ ganhou "Qual é a senha deste portal?"; mapa usa "Provas" e "Horas compl."; vídeos rápidos ordenados pela jornada (nível da trilha) e rotulados quando são partes do Nível 1.
- `.txt` ("Ler a narração") e `.vtt` de 26 vídeos regravados a partir do áudio real (Whisper + revisão); `aula/cap_00` ganhou os dois. Só o Nível 1 já era fiel. O player não usa `.vtt` (legenda é queimada no vídeo).
- **Regra única da mensalidade** (confirmada pelo responsável). Frase-padrão: *"A mensalidade vence todo dia 25. Na 1ª mensalidade (a do mês da sua turma), todos os descontos valem até o dia 25. Da 2ª em diante: até o dia 10, 25% de desconto de pontualidade; do dia 11 ao 25, 15%; depois do dia 25, sem esse desconto (a bolsa continua). Se o dia 10 ou o 25 cair em fim de semana ou feriado, vale o próximo dia útil."* Está igual (ou em recorte) em: `aviso_pagamento` (`server/meuSemestre.js`), card `mensalidadeCardHtml` e `financeiroHtml` (`meu-semestre.js`), FAQ "Quando vence" e "E a primeira mensalidade" (com o exemplo turma de novembro → 25/11), nível 5 da Trilha (`learn` e `td5`) e resumo do vídeo "Quanto eu pago?". Ao mudar a regra, mudar em todos esses lugares.
- Painel, "Próximas datas": a mensalidade mostra o vencimento já no próximo dia útil (fim de semana + feriados nacionais fixos, Carnaval, Sexta-feira Santa e Corpus Christi, calculados em `diaUtil`/`pascoa` no `meu-semestre.js`) e explica quando o 25 mudou ("Este mês o 25 cai num domingo…"). É estimativa: o boleto tem a data certa. Feriado municipal não entra.
- Meu Semestre sem curso (tela e painel): "Ainda não encontramos as matérias do seu curso. Elas costumam aparecer em até 2 dias úteis depois da matrícula. Se demorar mais, fale com o acadêmico." + botão para o Atendimento.
- Textos: "Voltar ao início" em todas as telas; avisos só mostram a etiqueta "Importante" (prioridade alta), sem "Média"/"Baixa"; Atendimento com botão principal amarelo (`.atd-btn-star`) e o resto em azul (sem verde); polo vazio: "Ainda não temos o seu polo no cadastro. Por enquanto, o contato é o geral."; Trilha: "uns 5 minutos por nível".
- Central de ajuda, Aula Inaugural: "Boas-vindas" aparece como **Abertura** e os outros como **Capítulo 1 a 11**, igual ao que está escrito dentro dos vídeos (duração continua à esquerda).

**Contexto**
- QA completo com persona de calouro em `docs/qa/qa-calouro-2026-10-17.md` (telas, textos, áudio e imagem dos 30 vídeos). Protótipo das 3 variações do painel em `docs/propostas/painel-inicial.html`.

**Alternativas descartadas**
- Validar o RGM também sem a base de matriculados (bloquearia o ambiente local e qualquer polo fora do snapshot).
- Carregar os `.vtt` como `<track>`: a legenda já está queimada; seria duplicada na tela.

**Impacto**
- Pendentes que dependem de vídeo novo: cartão "Uns 15 minutos" (nível 1, parte 1, 0:14–0:25), telas de 2025 nos níveis 2, 3, 4 e 6, painel antigo no capítulo "Ajuda e certificado" da Aula, dois finais que citam vídeos inexistentes, número de WhatsApp fixo na imagem (nível 1 parte 4 e cap_10).
- Faltam URLs para linkar: Regulamento das Atividades Complementares, Calendário Acadêmico e Manual do Aluno (hoje apontam para a Área do Aluno).

### 2026-10-15 - Trilha é o guia principal; tutoriais viram consulta

**Decisão**
- Mapa assunto → nível em `server/trilha.js` (`guiaTrilha`): categoria do tutorial (Primeiros passos 1, Área do Aluno/Documentos 2, Blackboard/Atividades 3, Provas 4, Financeiro 5); sem categoria, o tipo do item do Meu Semestre (atividade 3, disciplina/avaliação integrada 4).
- `/api/tutoriais` e `/api/meu-semestre` mandam `trilha: { nivel, titulo }` em cada item. Botões `data-open-trilha="N"` abrem `/trilha#nivel-N`, rolam até o nível e o deixam aberto mesmo sem terminar o anterior (consulta). O link funciona colado direto na barra.
- Meu Semestre: links de atividades/avaliação e o quadro "Não sabe como começar?" apontam para os níveis da trilha; tutoriais ficam como botão secundário.
- `/tutoriais`: faixa "Começando agora? Faça a trilha", link do nível em cada card e estado vazio que leva à trilha. No painel, o card Tutoriais passa a "consulta rápida" com botão de texto.
- Os 9 tutoriais de exemplo não são mais criados no boot. `tutoriais.retirarExemplos` desliga (`ativo = FALSE`, sem apagar) só as linhas com título **e** vídeo de teste originais; tutorial editado no admin com vídeo real fica no ar.

**Contexto**
- Trilha e tutoriais ensinavam os mesmos assuntos em dois lugares, com duas portas no painel; o Meu Semestre só conhecia os tutoriais, que eram todos o mesmo vídeo de exemplo.

**Alternativas descartadas**
- Apagar `csu_tutoriais` ou a tela de tutoriais: o admin continua podendo publicar vídeos curtos de consulta.
- Coluna `nivel_trilha` no banco: o mapa por categoria cobre os casos sem migração.

**Impacto**
- No primeiro boot após o deploy, os exemplos saem do ar e `/tutoriais` mostra o estado vazio até o admin cadastrar tutoriais reais. Para reativar um exemplo, troque o vídeo no admin (senão o boot desliga de novo).

### 2026-10-15 - Trilha "EaD Digital para Iniciantes" (`/trilha`)

**Decisão**
- Nova tela `trilha-page` (`/trilha`) + card no dashboard + aba **Trilha** no `/admin`. Stack atual: JS vanilla (`public/js/trilha.js`), CSS escopado em `.trilha` (`public/css/trilha.css`), Express e Postgres.
- Conteúdo (7 níveis: resumo, dicas, telas, perguntas; o Nível 1 tem 4 partes de vídeo) em `server/assets/trilha.json`, exportado do artefato original. Mudar texto = commit.
- `GET /api/trilha` envia o conteúdo **sem gabarito**. `POST /api/trilha/resposta` corrige no servidor e só devolve a resposta certa e a explicação depois do acerto. Pontos calculados no servidor: 100 de primeira, 40 depois, 50 pelo vídeo.
- Progresso por aluno em `csu_trilha_progresso` (PK `aluno_id, nivel`; partes vistas, vídeo ok, pulou, respostas, "Travei") e tarefas da semana em `csu_trilha_tarefas`. Criadas com `CREATE TABLE IF NOT EXISTS` no boot e na primeira chamada. Sempre por `req.aluno.id`.
- Vídeos MP4 (~100 MB), capas, legendas `.vtt` e narração `.txt` em `public/trilha-midia/videos/`; telas WebP em `public/trilha-midia/telas/`. Servidos pelo `express.static`, com suporte a Range. Pasta **não** se chama `/trilha` para não colidir com a rota da tela.
- WhatsApp da ajuda vem de `atendimento.getAtendimento` (número do polo). Sem DDD válido, usa (11) 91518-4535.
- Preferências de leitura (letra maior, vídeo mais devagar, ver tudo) ficam no `localStorage` do aparelho (`csu-trilha-prefs`).
- Admin: `GET /api/admin/trilha` (por nível, perguntas com mais erros, onde tocaram "Travei") e `GET /api/admin/trilha/export.csv` (para o CRM chamar quem parou).

**Contexto**
- A trilha vivia num artefato público com progresso só no `localStorage`. No portal, o aluno logado continua de qualquer aparelho, e a equipe vê onde a turma trava.

**Alternativas descartadas**
- YouTube não listado (pedido: vídeos no próprio servidor).
- Gabarito no front (aluno veria a resposta no código).
- Volume do EasyPanel para os vídeos (exigiria upload manual; o repositório mantém tudo versionado).

**Impacto**
- A imagem Docker cresce ~100 MB por causa dos vídeos. Trocar um vídeo = substituir o arquivo em `public/trilha-midia/videos/` com o mesmo nome e fazer push.
- O progresso do artefato antigo não migra (era `localStorage` de outro domínio).

### 2026-10-15 - Trilha liberada só para contas de teste (`TRILHA_LIBERADA_PARA`)

**Decisão**
- A trilha e tudo que aponta para ela só aparecem para contas em `TRILHA_LIBERADA_PARA` (Environment do EasyPanel): RGM ou e-mail, separados por vírgula. `*` = todos. **Vazio = ninguém** (padrão seguro).
- Quem não está na lista vê o portal como antes: sem card da trilha, sem faixa nos Tutoriais, sem links "Nível N da trilha" nos Tutoriais/Meu Semestre (o servidor remove o campo `trilha`), textos antigos de volta. As rotas `/api/trilha*` respondem 404 e `/trilha` volta ao início.
- `GET /api/recursos` informa à tela se a conta tem a trilha (`body.trilha-on`; CSS `.so-trilha` / `.sem-trilha`).
- Os 9 tutoriais de exemplo só são desligados no boot quando `TRILHA_LIBERADA_PARA=*`; antes disso o boot volta a usar `seedIfEmpty` (nada muda em produção).

**Impacto**
- Para liberar para todos: `TRILHA_LIBERADA_PARA=*` no EasyPanel e reiniciar. Para desligar: apagar a variável.

### 2026-09-02 - Deploy na `main` via GitHub Actions + EasyPanel

**Decisão**
- Produção é `main`. Agentes e humanos não abrem branch/PR para este repo.
- CI em push/`workflow_dispatch` builda a imagem, envia para `ghcr.io/caiovpinheiro/app_alunos:latest` (e tag do SHA) e depois faz POST na Deployment Trigger URL (`EASYPANEL_DEPLOY_APP`). A URL não vai para o código.
- No EasyPanel, Source = Docker Image `ghcr.io/caiovpinheiro/app_alunos:latest`.

**Contexto**
- EasyPanel já tem o app e o secret no GitHub. Faltava o workflow e a regra de não ramificar.

**Alternativas descartadas**
- Continuar com branches `cursor/*` e merge manual.
- Auto-deploy só pelo webhook do GitHub no EasyPanel, sem Action visível no repo.

**Impacto**
- Quem for agente daqui pra frente altera `main`; a imagem sobe no GHCR e o EasyPanel puxa `:latest`. Pacote privado no GHCR exige usuário/PAT com `read:packages` no EasyPanel (ou deixar o pacote público).

### 2026-08-19 - Finalização do Portal do Aluno (Certificado da Aula Inaugural)

**Decisão**
- Stack: frontend vanilla JS organizado em módulos (`public/js/*`) + backend Node/Express mínimo (`server/index.js`). Nenhum framework novo introduzido (protótipo era HTML único com CDNs).
- Certificado: geração client-side com `pdf-lib` sobre o template oficial `public/assets/certificado-template.pdf`. Os dados variáveis do aluno original são **removidos do content stream** (seções `q...Q` identificadas pelas coordenadas) e redesenhados com Montserrat-Regular embutida — em vez de cobrir com retângulos brancos (que manteria os dados antigos extraíveis no arquivo).
- Autenticação: `POST /api/auth/login` com usuário de teste via `.env` → token opaco em memória (Bearer). Páginas internas protegidas no frontend; emissão exige token no backend.
- Registro de emissão: append em `data/emissions.jsonl`; `certificate_id` gerado no backend (`CSU-AAAA-XXXXXXXX`); `created_at` oficial do servidor em `America/Sao_Paulo`.

**Contexto**
- Protótipo do Google AI Studio tinha login fake, backend mockado e certificado redesenhado em HTML/html2pdf — tudo removido conforme especificação.

**Alternativas descartadas**
- React/Vite: spec proíbe framework novo sem necessidade.
- Cobrir texto antigo com retângulo branco: deixaria PII do aluno original extraível no PDF.
- Geração do PDF no backend: spec permite frontend; client-side reduz carga e simplifica preview (Blob URL).

**Impacto**
- Produção precisa: substituir usuário de teste por IdP/banco acadêmico, persistir tokens, e migrar o registro JSONL para banco. Pontos de integração isolados em `server/index.js` e `public/js/api.js` (URL via `CERTIFICATE_API_URL`).

### 2026-08-24 - Avisos e notificações do aluno

**Decisão**
- Tabelas novas `csu_avisos` e `csu_aviso_leituras` via `CREATE TABLE IF NOT EXISTS` (sem DROP). Público `todos|polo|curso`; polo/curso do aluno = último `csu_certificados`. Recorrência mensal visível nos 7 dias até `dia_recorrente`, com data em `America/Sao_Paulo`.
- APIs autenticadas: `GET /api/avisos`, `GET /api/avisos/nao-lidas`, `POST /api/avisos/:id/lida`. Sem painel admin; seeds em `sql/seed_avisos.sql`.
- UI: sino + badge, card no dashboard e tela `avisos-page`. Certificado, login e tabelas antigas intactos.

**Contexto**
- Primeira fatia da área do aluno após o certificado. Curso/polo ainda não existem em `csu_alunos`.

**Alternativas descartadas**
- Colunas `curso`/`unidade` em `csu_alunos` nesta etapa (evita migração de dados agora).
- Painel admin de CRUD (pedido: testar por INSERT SQL).
- `CURRENT_DATE` no Postgres (UTC no servidor distorce a janela recorrente).

**Impacto**
- Aluno sem certificado só vê avisos `publico='todos'`. Variáveis `MATRICULADOS_*` ficam no `.env` para etapa futura; não entram neste fluxo.

### 2026-08-24 - Tutoriais, atendimento, indicações e /admin

**Decisão**
- Tutoriais em `csu_tutoriais`: só URL do YouTube; embed gerado no backend (`youtube-nocookie`) e iframe só no clique.
- Atendimento usa último polo de `csu_certificados`, com WhatsApp por polo em `csu_contatos_polo` e fallback `WHATSAPP_*_PADRAO`.
- Indicações em `csu_indicacoes`: grava no banco primeiro; `INDICACAO_WEBHOOK_URL` é opcional e nunca vai ao frontend.
- Admin em `/admin` com tabelas `csu_admins` / `csu_admin_sessoes` — não reutiliza login do aluno.

**Contexto**
- Continuação da área do aluno após avisos, sem alterar certificado/auth/notificações.

**Alternativas descartadas**
- HTML/embed livre nos tutoriais (risco XSS).
- Autorizar admin com a mesma sessão do aluno.
- CRM completo de indicações.

**Impacto**
### 2026-09-02 - Meu Semestre (área autenticada)

**Decisão**
- Nova tela `meu-semestre-page` + card de destaque no dashboard, no stack atual (HTML/CSS/JS vanilla, Express, Postgres). Sem React e sem progresso/porcentagem de atividades.
- Tabelas `csu_semestre_planos`, `csu_semestre_itens`, `csu_semestre_eventos` e `csu_semestre_mensalidades` via `CREATE TABLE IF NOT EXISTS`. API `GET /api/meu-semestre` autenticada: aluno só por `req.aluno.id`, curso só de `csu_alunos`.
- Dados acadêmicos 2026/2 (Administração) em `sql/seed_meu_semestre.sql`; mensalidade do Atol em `sql/seed_meu_semestre_atol.sql`. Nenhum seed roda no boot.

**Contexto**
- Primeira fatia acadêmica/financeira do portal. CRUD admin e conciliação automática de pagamentos ficam para etapa seguinte.

**Alternativas descartadas**
- Importar o protótipo React/shadcn do zip (quebra a arquitetura e a spec).
- Aceitar `aluno_id` no frontend (risco de IDOR).
- Executar o SQL acadêmico no `ensureSchema` (produção não deve popular sozinha).

**Impacto**
- Operação precisa rodar os SQL manuais após o deploy. Aluno sem `curso` em `csu_alunos` ou sem plano do curso vê estado vazio. Mensalidades são por aluno, não por curso.

### 2026-09-02 - Imagens do plano de estudos (SVG/PNG)

**Decisão**
- Geração in-app em `server/planoImagem.js`, a partir de `meuSemestre.getMeuSemestre`. Sem n8n e sem IA. SVG personalizado + PNG via `sharp`. Logo em `server/assets/cruzeiro-virtual.png`.
- Rotas do aluno: `GET /api/meu-semestre/imagem.svg` e `.png`, só com `req.aluno.id`. Botão “Baixar meu plano de estudos” na tela já existente. Cache em `csu_semestre_imagens` + arquivos em `PLAN_IMAGE_OUTPUT_DIR` (volume, não pasta pública).
- Worker interno (concorrência 2–3, `FOR UPDATE SKIP LOCKED`). Admin `POST /api/admin/planos-imagens/gerar-lote` retorna na hora; `GET .../status` mostra totais. `PLAN_IMAGE_AUTO_SYNC=true` processa alunos novos a cada `PLAN_IMAGE_SYNC_INTERVAL_MIN`.
- Link compartilhável: `share_token` (64 hex) em `csu_semestre_imagens`. `GET /api/meu-semestre/imagem-url` (autenticado) devolve só `{ url }`. Público `GET /p/plano/:token.png` serve a PNG inline, sem gerar de novo. `APP_PUBLIC_URL` no EasyPanel (ex.: `https://aluno.seudominio.com`).
- Fontes Arimo em `server/assets/fonts/` embutidas no SVG na hora do PNG (evita quadradinhos no Alpine). Fingerprint `v: 2` regenera PNGs antigas.
- PNG binária em `csu_semestre_imagens.imagem_png` (BYTEA) para o CRM puxar do Postgres. Disco em `/data/planos-estudos` continua como cache. Lote reprocessa concluída sem `imagem_png`.

**Contexto**
- Meu Semestre já existia. A imagem é só uma projeção visual dos mesmos dados. Quadradinhos vinham da falta de fonte no container.

**Alternativas descartadas**
- n8n / geração por IA.
- Recriar tabelas/tela de Meu Semestre.
- Expor `/data/planos-estudos` como estático.
- URL com `aluno_id` (adivinhável / IDOR).

**Impacto**
- EasyPanel: volume `planos-estudos` em `/data/planos-estudos`; `PLAN_IMAGE_*` e `APP_PUBLIC_URL`. Schema sobe no boot. CRM lê `imagem_png` + `share_token`. WhatsApp/e-mail também podem usar `/p/plano/<token>.png`.

### 2026-09-03 - Planos por matérias (Supabase → CRM/WhatsApp)

**Decisão**
- Tabela espelho `csu_materias_alunos` (sync de `materias_alunos` no Supabase por RGM) e `csu_materias_imagens` (PNG em `imagem_png`, `share_token`, URL pública).
- Admin: `POST /api/admin/materias-imagens/sync`, `POST .../gerar-lote` (só alunos sem PNG), `GET .../status` com último RGM, `GET .../crm`, `GET .../export.csv`.
- Cruza RGM com `csu_alunos`; cria aluno placeholder se faltar; atualiza nome vazio a partir do Supabase.
- Meu Semestre: se o aluno tem `csu_materias_alunos`, a tela usa essas disciplinas (não só o plano genérico de Administração). Sem matérias e sem plano do curso, continua vazio.
- CLI: `node tools/gerar-materias-imagens.js [sync|gerar|all|status]`.

**Contexto**
- Ingressantes desde set/2025 com matérias no Supabase; CRM precisa de URL pública da PNG para variável no disparo WhatsApp.

**Impacto**
- EasyPanel: `MATERIAS_SUPABASE_URL`, `MATERIAS_SUPABASE_KEY`, `APP_PUBLIC_URL`. SQL CRM: join `csu_materias_imagens` + `csu_materias_alunos` + `csu_alunos`.

### 2026-09-03 - Admin do Environment no boot

**Decisão**
- `seedAdminIfEmpty` passa a garantir o admin de `ADMIN_EMAIL` / `ADMIN_PASSWORD` (cria ou atualiza senha). O registro antigo `admin@local` não é mais o único caminho de login.

### 2026-09-02 - Rotas por tela (`/meu-semestre`, `/tutoriais`, …)

**Decisão**
- Cada tela do portal tem URL própria via History API. O servidor devolve `index.html` nesses caminhos. `/admin` permanece separado.

**Contexto**
- Antes tudo vivia em `/`; o aluno não conseguia abrir ou compartilhar uma tela específica.

**Alternativas descartadas**
- Hash (`#/tutoriais`).
- Framework de rotas.

**Impacto**
- Recarregar `/meu-semestre` ou `/tutoriais` funciona. Sem sessão, a URL é lembrada e o aluno volta para ela depois do login.


## 2026-10-20 — Refatoração visual do Início (/inicio) e da Central de ajuda (/tutoriais)
Pacote `Portal_Aluno_Refatoracao_Claude_Code.zip`, aplicado sem commit, com 3 desvios aprovados pelo usuário:
1. **FAQ por assunto, tudo fechado**: o menu de assuntos fica; as perguntas viram acordeão de botões (`aria-expanded` + `aria-controls` + `role=region`), uma aberta por vez.
2. **Sem botão flutuante "Preciso de ajuda"**: a ajuda humana fica no card "Ainda precisa de ajuda?" (Início e Central). O webchat do CRM continua sendo o único elemento flutuante.
3. **Atalhos**: Meus estudos → Meu Semestre; Provas e notas → Área do Aluno (Vida Acadêmica, externo); Mensalidades → Área do Aluno (Financeiro, externo); Central de ajuda → /tutoriais. Os externos dizem "Abre a Área do Aluno". Aula Inaugural + certificado e "Falar com a equipe" ficam numa área secundária no fim do Início.

Decisões:
- Tokens do pacote quase iguais aos da marca já usada (trilha/central): valem os atuais, expostos como `--portal-*` em `public/css/portal.css`. Container de até 1280px.
- Menu do topo (Início · Meu semestre · Central de ajuda) em todas as telas logadas, com `aria-current`; abaixo de 1024px fica numa segunda linha.
- Banner do Início (`public/js/inicio.js`): sem progresso → "Seu polo está aqui para ajudar você a estudar." + "Conhecer os primeiros passos" (abre a trilha; sem trilha liberada, os tutoriais); trilha em andamento → "Vamos continuar?" + barra de níveis reais; trilha concluída → "Acompanhe seu semestre." + Meu Semestre. Nome vem da sessão; sem nome, "Olá! Vamos começar?".
- Próximas datas: até 3, cada uma com botão do tipo (Ver pagamentos → Área do Aluno; Consultar prova / Ver disciplina / Ver no calendário → Meu Semestre). O pacote dizia não inferir mudança de vencimento em fim de semana/feriado, mas a regra confirmada pela equipe (próximo dia útil) prevalece.
- "Resolva em poucos minutos": curadoria fixa no front (`DESTAQUES_INICIO` em central.js: e-mail e senha, Duda, Pix), mesmo card e player da Central. Só aparece com a trilha liberada (o /api/central é da trilha).
- Central: banner compacto com formulário de busca (Enter = botão), assuntos fora do banner (5 + "Mais assuntos" com Área do Aluno, Horas complementares, Formatura), selecionado = azul-marinho + ✓; contagem real ("3 de 13 vídeos"); estado vazio "Não encontramos esse assunto." com "Limpar busca" (limpa busca e assunto); vídeo em diálogo com foco preso, Esc fecha, foco volta para "Assistir ao vídeo".
- Arte `public/assets/portal/hero-estudante{,-640}.webp` (srcset, `alt=""`, some abaixo de 640px).
- Pendente: a tela de tutoriais **sem** trilha liberada (`tutoriais.js`, vídeos do banco) ficou com o visual antigo; o Início sem trilha não mostra a seção de vídeos.

## 2026-10-20 — Refatoração de /meu-semestre (PLANO-MEU-SEMESTRE.md)
Sem commit. Arquivos: `public/js/meu-semestre.js` (renderPage reescrita), `public/css/semestre.css` (novo), `public/index.html` (container 1280, sem "Voltar ao início": o menu do topo cobre).
- **Texto picotado de "Vencimentos fixos"**: causa confirmada no CSS computado: `.ms-pay p { display:flex; gap:6px }` (styles.css) fazia cada `<strong>` virar item flex. A tela nova não usa mais `.ms-pay`; o texto completo está num acordeão (`#sm-financeiro`) com `p`/`ul`/`li` e `strong` inline. Não mexi na regra global.
- Ordem: banner compacto (curso · período da fonte) → aviso de prévia (portal oficial + "Baixar o Duda" expansível com App Store e Google Play) → disciplina atual (2/3) + mensalidades (1/3) → disciplinas (1/2/3 colunas, todas) → atividades (2 colunas) + Avaliação integrada separada → próximas datas + apoio → orientações financeiras.
- Disciplina: não há link por disciplina, então o botão é "Acessar o AVA" (ava.cruzeirodosul.edu.br). Várias "atual" ao mesmo tempo aparecem todas. Status mostrado como "Período encerrado / Em andamento / Próxima" (período, não aprovação).
- Prazos com o rótulo da fonte: "Prazo preferencial" e "Disponível até" (atividades); "Prazo até" (avaliação integrada). Nada vira "prazo final".
- Próximas datas: `cache.calendario` + `proximaMensalidade()`, a mesma fonte do Início (mesmo dia para o mesmo evento). Futuros primeiro; "Ver calendário completo" abre "Mais adiante" e "Datas anteriores". Intervalos com início e fim (`<time datetime>`).
- Financeiro: tirei duas frases sem fonte validada ("pode haver juros pequenos" e "em dezembro o 25 costuma ir para o 28"). **Pendente com a equipe**: confirmar juros/multa após o dia 25 e se a regra vale para todos os contratos.

## 2026-10-20 — Acompanhamento do aluno (percurso + follow-up)
Sem commit. Detalhes em `docs/integracao/acompanhamento.md`.
- Novo `server/acompanhamento.js` (tabelas `csu_acessos`, `csu_eventos`, `csu_followups`; sinais; mensagens sugeridas) e rotas em `server/index.js`: `POST /api/eventos` (aluno) e `GET /api/admin/acompanhamento`, `/export.csv`, `/:id` (percurso), `POST /:id/followup`.
- `/api/recursos` devolve `rastreio: true|false` (`RASTREIO_LIBERADO_PARA`, mesmo formato do chat). Local: `*`. Produção: vazio até validar a LGPD.
- `public/js/rastreio.js` agora tem dois destinos: o nosso servidor (sessão, tempo ativo, telas, cliques, vídeos 25/50/75/fim, eventos das telas) e o Bwipo (só os eventos explícitos). O logout espera o último envio (até 1,5 s).
- Admin: aba "Acompanhamento" (padrão ao entrar), em `public/js/admin-acompanhamento.js`. WhatsApp com mensagem pronta registra o contato; tem CSV para o CRM.
- O lote de eventos passa pelo `express.json` global (20 kb): no máximo 40 eventos por envio no front e 60 no servidor.
- Regras dos sinais editáveis no admin (botão "Regras dos sinais"): ligar/desligar, N, prioridade, mensagem com variáveis e "esconder contatados por N dias". Ficam em `csu_acomp_config`; o padrão é o mesmo de antes. Rotas `GET/PUT /api/admin/acompanhamento/regras` (`{reset:true}` volta ao padrão).

## 2026-10-20 — Aula Inaugural no topo, aplicativos em todas as telas, painel único de ajuda
Pacote `Portal_Aluno_Refatoracao_Claude_Code (2).zip` (PROMPT-ATUALIZACAO-AULA-APPS-AJUDA.md). Sem commit.
- **Início**: faixa "Comece pela Aula Inaugural" logo abaixo do banner ("Assistir à aula" usa o player de sempre via `data-open-aula`; "Gerar certificado de participação" é o mesmo `#btn-gerar-certificado`). A aula tem 11:35 (`duracao_s` 695), por isso "12 minutos". O card antigo do fim da página saiu.
- **Aplicativos** (`public/js/apps.js`, config única): Duda e Microsoft Authenticator com os ícones oficiais e os selos pt-BR da App Store e do Google Play (`public/assets/portal/apps/`, origem em `docs/integracao/apps-fontes-assets.json`). Um lugar `[data-apps-slot]` por tela: Início (depois da aula), Meu semestre (depois da abertura, antes do aviso de prévia; o acordeão "Baixar o Duda" saiu), Central (depois da faixa da trilha), tutoriais sem trilha, Trilha (depois da abertura), Avisos e Atendimento. "Como acessar" e "Como configurar" abrem os vídeos reais `acesso-entrar-duda` e `acesso-authenticator` (sem a Central liberada, vão para os tutoriais). O selo do Google tem margem transparente: 52px de arte dão 40px visíveis, a mesma altura do selo da Apple.
- **Ajuda** (`public/js/ajuda.js`): uma só instância de diálogo (aba lateral de 420px; tela cheia no celular). Abrem com `[data-help-open]`: o banner do Início, o card "Ainda precisa de ajuda?" (Início e Central), o estado vazio da Central, Meu semestre, o erro do certificado e o botão "Ajuda" no topo de todas as telas logadas. Caminhos: Não consigo entrar (subpainel com os 3 vídeos de acesso), Tenho uma dúvida (Central + foco na busca) e Falar com a equipe (WhatsApp acadêmico de `/api/atendimento`, sem tutorial antes). Tem foco preso, Esc, X, devolução do foco, rolagem do fundo travada e fechamento ao trocar de tela. Comercial e indicação ficaram fora do painel, no link "Comercial e indicação" (tela de Atendimento). O `#dash-whatsapp` saiu.
- Continua **sem botão flutuante** (decisão anterior: o chat do CRM já é flutuante). O botão "Ajuda" do topo faz esse papel.
- Fora: formulário e sucesso do certificado (`/certificado`, `/sucesso`) não têm a faixa de apps, por serem fluxo de uma tarefa só e sem o cabeçalho do portal. Os selos antigos de `/assets/stores/` não são mais usados pelo portal.
- Ajuste pedido pelo usuário: a faixa de aplicativos virou **"Primeiro acesso em 6 passos"**, sem os links "Como acessar/Como configurar". 1 Baixe o Duda e 2 Baixe o Microsoft Authenticator (selos oficiais); 3 Descubra seu e-mail e senha, 4 Crie a sua senha, 5 Ligue o Authenticator e 6 Entre no Duda abrem os vídeos `acesso-email-senha`, `acesso-criar-senha`, `acesso-authenticator` e `acesso-entrar-duda` (a mesma ordem do Nível 1 da trilha). Com a trilha liberada, há o link "Passo a passo completo no Nível 1 da trilha".

## 2026-10-20 — Aula Inaugural como programa único (aula + trilha + certificado de 4 horas)
Aprovado pelo usuário (proposta `docs/propostas/aula-inaugural-programa.html`): meta de **1.800 pontos**, **7 módulos obrigatórios**, **ordem livre**, quem já emitiu continua podendo emitir, aula completa sem pontos. Sem commit.
- **Conteúdo** (`server/trilha.js` + `trilha.json`: `meta_certificado`, `horas_certificado`): cada nível vira um "Módulo", e o vídeo dele passa a ser o(s) capítulo(s) da aula (`nivel_trilha` em `central/aula-inaugural.json`). Os módulos 3 e 5 têm 2 capítulos. Os vídeos antigos da trilha (partes do passo a passo dos níveis 1 e 5 e os vídeos `nivelN`) ficaram em "Passo a passo em vídeo (opcional, sem pontos)". A abertura (caps. 0 e 1) e o encerramento (cap. 11) não valem pontos. O máximo continua 2.550.
- **Regra do certificado no servidor** (`POST /api/certificates`): com a trilha liberada e sem certificado anterior em `csu_certificados`, exige os 7 módulos concluídos e 1.800 pontos; senão devolve 422 `aula_incompleta` com o que falta. Sem a trilha liberada, nada muda. `GET /api/trilha/resumo` agora traz `feitos[]` e `certificado {meta, horas, pontos, faltam_*, liberado, emitido, emitido_em}`.
- **Início**: card "Aula Inaugural · certificado de 4 horas" (`#home-aula`, em `inicio.js`) com 4 estados: começar, continuar o módulo N (módulos + pontos/meta), emitir certificado e já emitido. Com a trilha liberada, o banner deixa a trilha e fala do semestre ("Ver meu semestre"). Sem a trilha, continua a faixa simples com o certificado de antes.
- **Tela /trilha** (título "Aula Inaugural"): todos os módulos abertos; o placar mostra os pontos para a meta e o que falta; há "Travei neste módulo" nos módulos com um vídeo só; o bloco "Encerramento e certificado" tem o botão de emissão. No menu, a tela marca "Início".
- **Textos**: "Nível N da trilha" virou "Módulo N da Aula Inaugural" na Central, no Meu semestre, nos aplicativos e nos tutoriais. A nota de certificado da Central agora leva aos módulos. As tarefas da 1ª semana dizem "(módulo N)".
- O botão de certificado agora é genérico (`[data-gerar-certificado]` em `app.js`), com o erro aparecendo na própria caixa (`#home-aula-erro` / `[data-cert-erro]`).
- Testado: bloqueio com 0 e com 6 módulos (1.840 pts); liberação com 7 módulos (2.130 pts). O progresso do aluno de teste foi restaurado depois do teste.
- **Capítulos na Central (20/10)**: a seção "Aula Inaugural por assunto" saiu da Central (eram os mesmos vídeos dos módulos). Os 7 capítulos que explicam o que os vídeos rápidos não cobrem (`na_central: true` em `aula-inaugural.json`: Como funciona o EaD, Área do Aluno, Seu mês de estudo, Tutor e avisos, Provas e notas, Rumo à formatura, Ajuda e certificado) entram na grade como "Entenda como funciona" (id `aula-cap-N`, depois do vídeo de tarefa do mesmo módulo). Os repetidos (primeiro acesso, pagamentos, rematrícula, horas) não entram. A busca da Central agora também procura na narração (`.txt`) de cada vídeo (`termos`). A **aula completa** (12 capítulos em sequência, sem pontos) ficou num bloco recolhível na tela da Aula Inaugural; `[data-open-aula]` abre esse bloco (`Trilha.abrirAulaCompleta`).
- `docs/qa/prompt-correcao-videos.md` ganhou a seção "Aula Inaugural como programa único": as falas que citam "nível N da trilha", "Trilha EaD para Iniciantes", "Atendimento > Suporte" e "Gerar Certificado", e 6 vídeos rápidos novos (AVA, atividade do mês, tutor, prova, documentos pendentes, declaração/CAA), com o conteúdo vindo dos capítulos.
- **Boas-vindas novo (20/10)**: `public/trilha-midia/aula/boasvindas.{mp4,jpg,txt,vtt}` (40 s, 1920×1080). **Refeito em Avatar IV** (`POST /v3/videos`, type image, expressividade média, motion_prompt de cabeça natural; vídeo HeyGen `d1a5154e…`), porque o primeiro render (talking photo clássico) ficou travado: o movimento médio subiu de 0,41 para 1,33 (os capítulos antigos têm 1,81). Voz: ElevenLabs "Tutora Roberta (CSul)" (`RGymW84CSmfVugnA5tvA`, eleven_v3, stability 0,5). Avatar: HeyGen, a mesma foto dos capítulos (talking photo `3cdb6d44…`, de cap_10_00), com o vídeo `48fdfd1f…`. Cartões em HTML renderizados com o Chrome headless e montados com ffmpeg; a legenda vem do alinhamento por caractere do ElevenLabs. A abertura da frase é neutra ("Que bom ter você aqui"), porque o v3 dizia "bem-vinda". Não promete "uma matéria por mês". Em `server/trilha.js`, `BOAS_VINDAS` substitui os caps. 0 e 1 na abertura e na aula completa, só se o .mp4 existir. O cap. 1 segue na Central ("Entenda como funciona"). Arquivos de trabalho (roteiro, cenas, script): scratchpad da sessão, `boasvindas/`.
- **Capas dos vídeos 'Entenda como funciona' (20/10)**: as 7 capas que faltavam (aula-cap-1/3/4/5/6/10/11) foram criadas no mesmo estilo dos outros 13 vídeos da Central e salvas em public/trilha-midia/capas/, ligadas pelo campo `capa` em aula-inaugural.json. Em server/central.js, o bloco que monta os vídeos da categoria 'Entenda como funciona' agora usa `x.c.capa || null` (antes era sempre null).
- **Formatura (decisão do usuário, 20/10)**: os cursos EaD não exigem TCC; fala-se só em **estágio obrigatório** (para os cursos que têm, conferido no Histórico). O **ENADE não é obrigatório para todos**: o INEP escolhe a cada ano quais cursos participam, e só quem conclui um curso chamado naquele ano precisa fazer. Corrigidos o módulo 7 do `trilha.json` (resumo, as 3 perguntas, mantendo `certa` na mesma posição, e o glossário, onde TCC virou "Estágio obrigatório") e o FAQ `formar-requisitos`. O `videos/nivel7` saiu do passo a passo (`APOSENTADOS` em `server/trilha.js`). As falas e os cartões do `aula/cap_09` estão no `prompt-correcao-videos.md` para regravar.
- **DP e adaptação (20/10)**: o caminho foi confirmado pela aula ao vivo de 2026.1 e pelo vídeo do YouTube Fw4C-Y3KoBk (2020, portal da UNICID). DP e adaptação entram **na própria rematrícula**, no bloco "DPs/Adaptações" ao lado da "Série Regular" (Área do Aluno → Rematrícula → aceitar o contrato → marcar → Gravar → pagar o boleto). Saiu o "parte de matérias atrasadas" e o "é só pagar o boleto" do FAQ (`dp-adaptacao`, `rematricula`), do módulo 5 (learn 6 e 7, pergunta 3 com a mesma `certa`) e do glossário. O vídeo `tut_dp` ainda não existe; o roteiro e os pontos a confirmar (oferta da DP no mesmo mês do ano seguinte, concluinte pode incluir todas, boleto = 1ª mensalidade, pré-matrícula) estão nos itens 15 e 16 do `prompt-correcao-videos.md`.
- **Definições de DP e adaptação (usuário, 20/10)**: **DP** = matéria em que o aluno foi reprovado; ele pode cursar de novo, incluindo na rematrícula ou nos meses em que ela for oferecida. **Adaptação** = matéria que ficou para cursar, quase sempre porque o aluno aproveitou disciplinas e avançou de semestre. Aplicadas no FAQ `dp-adaptacao`, no módulo 5 (learn 7 e 8) e no glossário. O roteiro e as cenas do `tut_dp` (baseados no vídeo do YouTube Fw4C-Y3KoBk; sem usar as imagens dele, que mostram dados reais) estão no item 15 do `prompt-correcao-videos.md`.
- **cap_09 "Rumo à formatura" refeito (20/10)**: mesmo arquivo (`public/trilha-midia/aula/cap_09.{mp4,jpg,txt,vtt}`, 61 s). Roteiro aprovado com estágio obrigatório (sem TCC) e ENADE só quando o INEP chama o curso; voz da Roberta (ElevenLabs v3, "Enade"/"Inep" lidos como palavra, conferido no Whisper), avatar em Avatar IV (vídeo HeyGen `b3e49e58…`, ~140 créditos), 7 cartões e legenda no estilo do boas-vindas. Na tela, legenda e cartões em caixa alta (ENADE/INEP). O antigo está no scratchpad (`formatura/antigo/`). `aula-inaugural.json`: duração 1:01, resumo novo, `duracao_s` 694.
- **Vídeo de DP e adaptação na Central (20/10)**: o vídeo do YouTube Fw4C-Y3KoBk entrou como card `yt_dp` ("Incluir DP e adaptação na rematrícula", Área do Aluno, módulo 5) em `videos.json`, com o campo novo `yt` (toca num iframe youtube-nocookie no mesmo modal; `server/central.js` repassa `yt` e `termos` extras para a busca). Capa `capas/yt_dp.webp` feita da miniatura, **com o nome e o RGM da aluna que aparece no vídeo desfocados**. A FAQ "O que é DP e adaptação?" ganhou o link "Ver o vídeo". O resumo do `tut_12` (rematrícula) foi corrigido: a série regular entra sozinha, DP e adaptação o aluno inclui. Fica valendo até o `tut_dp` próprio ser gravado (item 15 do prompt de vídeos).
- **Rematrícula: processo correto (usuário, 20/10)**: a rematrícula **não acontece sozinha** e não é só pagar. Passos: Área do Aluno → Rematrícula → **aceitar o contrato** → conferir as matérias da **Série Regular** → incluir ou não **DP/adaptação** (bloco DPs/Adaptações) → **Gravar** → pagar o boleto da rematrícula → esperar **2 a 3 dias úteis** (compensação) → voltar em Rematrícula e **conferir** se aparece "Você está rematriculado". Reescritos: FAQ `rematricula` e `dp-adaptacao`, módulo 5 (texto, legenda do print t18, pergunta "Precisa fazer mais alguma coisa?" com `certa: 1`, link para o vídeo do YouTube). O card `yt_dp` virou "Rematrícula passo a passo, com DP e adaptação". **`tut_12` saiu do ar** (`ativo: false`) e **`cap_07b` está errado** (as duas narrações dizem "é só pagar, acontece sozinha"); roteiro novo no prompt de vídeos, aguardando aprovação. O vídeo baixado pelo usuário (`~/Downloads/videoplayback (1).mp4`) é o mesmo do YouTube, **sem áudio** e com nome/RGM da aluna em todos os quadros: só serve como fonte de telas, com desfoque.
- **Avaliação 👍/👎 dos conteúdos (20/10)**: tabela de votos (um por RGM por conteúdo) e rotas em `server/avaliacoes.js`: `POST /api/avaliacoes {tipo: video|faq|aula, id, voto: 1|-1|0}`, `GET /api/avaliacoes/minhas`, `GET /api/admin/avaliacoes` (mais negativos primeiro). Aba "Avaliações" no admin (`admin.html`/`admin.js`). Botões em `public/js/avaliacao.js` + `avaliacao.css`: modal de vídeo e respostas da FAQ na Central, vídeo de boas-vindas e os 7 módulos na Aula Inaugural; após 👎 aparece o caminho para falar com o polo. Votos de teste apagados.
- **Layout da Aula Inaugural (20/10)**: as linhas sem pontos ("Aula completa") respeitam o padding do card (ícone e "Abrir" não vazam mais); o vídeo de boas-vindas ocupa ~60% do card com o texto ao lado (abaixo de ~900px, vídeo em largura total e texto embaixo). Listener global em `ui.js`: dar play em um vídeo pausa os outros. Conferido em 1440, 1024 e 375px.
- **cap_07b "Rematrícula" refeito (20/10)**: mesmo arquivo (`public/trilha-midia/aula/cap_07b.{mp4,jpg,txt,vtt}`, 48 s, antes 39 s). Roteiro aprovado com o processo correto (contrato → Série Regular → DP/adaptação → Gravar → boleto → 2 a 3 dias úteis → conferir "Você está rematriculado"); voz da Roberta (ElevenLabs v3), Avatar IV (vídeo HeyGen `dd0aefca…`), 8 cartões e legenda. Telas reais tiradas do vídeo do YouTube Fw4C-Y3KoBk (contrato, Série Regular, DPs/Adaptações, Gravar), com o **nome e o RGM da aluna cobertos por barra sólida** (o desfoque deixava ler). Capítulo agora com `na_central: true` e capa `capas/aula-cap-8.webp`; as duas FAQs (rematrícula e DP/adaptação) apontam para ele. `tut_12` continua fora; o card do YouTube (`yt_dp`, 4:14) fica como versão longa. O antigo está em `scratchpad/remat/antigo/`.
- **Aba "Aula Inaugural" do admin (20/10)** (ex-"Trilha"; ids, rota `/api/admin/trilha*` e `data-tab="trilha"` continuam). Números em `server/trilha-admin.js` (`resumoAdmin`, `exportAlunos`), separados de `server/trilha.js` para manter o limite de 500 linhas; a regra do certificado é a de `trilha.statusCertificado` (7 módulos + `META_CERTIFICADO`), e "certificado emitido" vem de `csu_certificados` via `certificadosEmitidos()` em `index.js` (mesma fonte de `certificadoEmitido`, então quem emitiu antes da regra continua contando). `GET /api/admin/trilha` devolve `iniciaram`, `concluiram`, `atingiram_meta`, `certificados_emitidos`/`certificados_total`, `funil[]`, `abertura` (play/fim do Boas-vindas por `csu_eventos`, só alunos com rastreio; `null` sem a tabela), `modulos[]` com `media_pontos`, `perguntas_dificeis[]` e `travei[]` com `modulo` (os campos `niveis`/`nivel` não existem mais). A "Aula completa" não é contada: usa os mesmos mp4 dos módulos e o evento de vídeo não distingue. CSV `aula-inaugural-alunos.csv` com módulos concluídos, pontos, meta, certificado (sim/não + data) e último acesso. Pendente: a aba Acompanhamento ainda diz "Trilha 0 de 7 níveis" e "Nível 1 da Trilha EaD" (`admin-acompanhamento.js` / `server/acompanhamento.js`).
- **"Sua primeira semana" automática (20/10, decisão do usuário)**: o checklist manual de 6 tarefas virou 4 itens sem caixa que se marcam sozinhos (`tarefas[].modulos` = módulos concluídos em `csu_trilha_progresso`; `certificado: true` = certificado emitido via `/api/trilha/resumo`); o que o portal não detecta (Duda, documentos, AVA, pagamento) saiu, e a caixa "Travou?" ficou só com o WhatsApp do setor acadêmico (sem o teleatendimento do Duda, que é indicado pelo Polo). `POST /api/trilha/tarefa` e `csu_trilha_tarefas` ficaram sem uso.
- **Vídeo "Incluir DP e adaptação" (`central/tut_dp`, 20/10)**: 63 s, voz da Roberta, Avatar IV, 7 cartões e legenda, roteiro aprovado com as regras do usuário: inclui na rematrícula ou durante o semestre (mesma tela: Rematrícula → DPs/Adaptações → Gravar, dentro da data limite de inclusão); **DP** é cobrada no mês em que é oferecida, valor perto de uma mensalidade mas não exato ("confira sempre no sistema"); **adaptação** sem cobrança se ficar no mesmo mês de uma matéria regular, cobrada como uma mensalidade se ficar sozinha no mês. Tela real do vídeo do YouTube (matéria incluída com "Limite para inclusão"), nome da aluna coberto. Entrou no passo a passo do módulo 5 (`parts` de `niveis[4]` em `trilha.json`) e a FAQ `dp-adaptacao` ganhou o caminho no meio do semestre e as regras de cobrança. Na Central: card `tut_dp` em `videos.json` (Área do Aluno, módulo 5, capa `capas/tut_dp.webp`), e o botão da FAQ `dp-adaptacao` abre este vídeo. Custo ~140 créditos (o primeiro envio falhou por falta de créditos; o usuário comprou mais).
- **Senha do primeiro acesso (regra confirmada pelo usuário, 20/10)**: o Duda **não mostra a senha pronta**; o aluno monta a senha assim, nesta ordem: as **3 primeiras letras do nome** (primeira maiúscula, resto minúsculo, com acentos) + **"@"** + os **3 primeiros caracteres do RGM** + os **4 primeiros números do CPF**. Ex.: Ana + @ + 512 + 9876 = `Ana@5129876` (é o exemplo fictício da Ana Souza que aparece no `nivel1_parte1`, que segue a regra). Não confundir com a senha deste portal de apoio (primeiro nome com inicial maiúscula + `123@`). A sessão "Dados de acesso do aluno" implementa a orientação (senha montada sob demanda, calculada no servidor, sem salvar nem logar; sem CPF, mostra a parte montável + instrução) e corrige os textos que dizem que o Duda mostra a senha (FAQ e módulo 1). **Vídeos a corrigir**: `videos/nivel1_parte1` (1:20–1:30, tela do Duda com "possível senha" já preenchida e a fala "E essa é a sua primeira senha") e `aula/cap_02` (fala "O Duda mostra o seu e-mail acadêmico e a sua primeira senha").
- **Pontuação simples (20/10, decisão do usuário: 1.800 assustava)**: cada módulo **concluído** vale `PONTOS_MODULO` = 10 (`trilha.json` `pontos_modulo`); máximo e meta = 70 (`meta_certificado`, limitado ao máximo, então a meta é o mesmo que concluir os 7). Vídeo e acerto de primeira não dão pontos extras; errar não tira. Os pontos saem de `concluido_em` na leitura, então o progresso salvo na escala antiga (vídeo 50, pergunta 100/40, meta 1.800) vale **sem migração**; a coluna `pontos` virou cache. Aplicado no aluno, no Início, na Central, no admin (cards, funil, CSV). Quem já emitiu o certificado continua valendo. **Pendente**: o vídeo de boas-vindas ainda fala em "mil e oitocentos pontos" e tem o cartão "7 + 1.800".
- **Acesso em preparação (20/10)**: o polo cria a conta antes de a faculdade gerar RGM e e-mail acadêmico (`server/preparo.js`, rotas no admin; conta com RGM NULL, entra com o e-mail pessoal e a senha inicial do portal, primeiro nome + 123@). O app mostra o básico sem erro nem tela em branco: banner "Seu acesso está sendo preparado", cabeçalho "Acesso em preparação", cartão de dados de acesso levando à Aula Inaugural; o progresso fica salvo e o certificado espera o RGM (ele vai no certificado). Quando o RGM sai, o polo informa no admin ou a sincronização de matriculados completa a conta pelo e-mail pessoal. Observação da sessão: o Início dessa aluna tem 3 chamadas para a Aula Inaugural (banner, card e cartão); dá para enxugar depois.
- **Admin › Aula Inaugural, painéis novos (20/10)**: "Onde trava" (atrito por módulo com vários sinais: abandono, tempo, erros, "Travei", 👎), "Alunos presos" (onde parou, há quantos dias, motivo provável), "Uso" (`public/js/admin-aula.js`: tempo ativo, minutos de vídeo, vídeos mais vistos, índice de 👍) e "Por aluno" (matriz aluno × módulo + CSV aluno × módulo para o CRM).
- **Logo (20/10)**: `public/assets/logo-csv.webp` com fundo transparente (sumiu o retângulo branco no cabeçalho translúcido).
- **Votos de teste (20/10)**: apagados os 👍/👎 de teste da conta RGM 123456; o admin "Avaliações" começa zerado.
- **`tut_12` aposentado (20/10)**: saiu do `videos.json`; arquivos em `~/Documents/app_alunos-video-backup-2026-10-20/aposentados/`. O `cap_07b` novo e o `tut_dp` cobrem a rematrícula; não regravar.
- **Aba Acompanhamento com nomes novos (20/10)**: rótulos de eventos, cartão do aluno ("Aula Inaugural: X de 7 módulos") e detalhe ("Módulo N · título") em `admin-acompanhamento.js` (v=4); regras `travou_trilha`/`parou_trilha` em `server/acompanhamento.js` com rótulo, descrição e mensagem novas ("módulo {nivel} da Aula Inaugural"; "Falta pouco para o certificado de 4 horas!"). `MENSAGENS_ANTIGAS`: se a config salva no banco tem exatamente o texto padrão antigo, ele vira o padrão novo na leitura; mensagens personalizadas ficam como estão (os ids das regras e as variáveis `{nivel}`/`{nivel_titulo}` não mudaram).
- **Remendos de vídeo: senha montada e pontuação nova (20/10, aprovados pelo usuário)**. Técnica: só o trecho errado é refeito (voz da Roberta no ElevenLabs + Avatar IV com lip-sync no mesmo enquadramento do original; cena recriada a partir do quadro original com a parte errada coberta), cortado em silêncio e emendado com `concat`, volume igualado (loudnorm no LUFS do original). Originais em `~/Documents/app_alunos-video-backup-2026-10-20/antes-remendos-senha-pontos/`.
  - `videos/nivel1_parte1` (1:46): o campo "Sua possível senha de primeiro acesso" fica coberto de 1:14,6 até o fim; em 1:22 entra um trecho de 16 s com o cartão "Monte a sua 1ª senha" (Ana + @ + 512 + 9876 = Ana@5129876, blocos aparecendo na fala). Duração e resumo atualizados no `videos.json` (`acesso-email-senha`).
  - `aula/cap_02` (0:59): a cena "Anote num papel" de 0:20,47 a 0:27,27 foi refeita com o mesmo desenho do cartão, a linha "Primeira senha · você monta" com os 4 blocos, a etiqueta "o Duda mostra" no e-mail e a frase "O Duda mostra o e-mail. A senha, você monta."; a segunda parte da cena (senha nova) é a original.
  - `aula/boasvindas` (0:40): a cena 4 (0:24,57 a 0:31,50) diz "Concluiu os 7 módulos? São 70 pontos, e você ganha o certificado de 4 horas", com o cartão "7 módulos = 70 pontos → Certificado de 4 horas".
  - `aula/cap_10` "Ajuda e certificado" (0:57, refeito inteiro): Tutoria no AVA; declaração em Emissão de Documentos e outros pedidos no CAA Online; botão Ajuda → setor acadêmico no WhatsApp com o RGM à mão; Central de ajuda; certificado liberado com os 7 módulos (70 pontos). Sem "Trilha/Nível", sem número fixo e sem o cartão final antigo.
  - Custo: ~210 créditos do HeyGen (4 avatares). `.txt` e `.vtt` refeitos (fora do trecho, as legendas originais só foram deslocadas no tempo).
- **Revisão geral (20/10, fim do dia)**: Aula Inaugural, Início (com e sem RGM), Meu semestre, Central e admin conferidos em 1440 px e 375 px, sem erros de console do app (só o iframe do webchat do CRM, que recusa abrir em localhost). Dois defeitos de celular corrigidos: (1) a caixa "Dica" dos módulos (`.tip`, flex) quebrava o texto em colunas quando tinha negrito/link — o texto agora vai num `<span>` (`trilha.js` v=22); (2) a Central rolava para o lado em 375 px porque o texto oculto (`sr-only`, absolute) das abas da FAQ escapava da faixa com rolagem — `.c-ftab{position:relative}` (`central.css` v=9). A senha montada no módulo 1 foi testada: o CPF digitado não sai do aparelho (nenhuma requisição com ele).
- **Vídeo do YouTube da rematrícula removido (20/10, pedido do usuário)**: saiu o card `yt_dp` ("Rematrícula passo a passo, com DP e adaptação", Fw4C-Y3KoBk, portal antigo da UNICID) do `videos.json`, a capa `capas/yt_dp.webp` e o link para ele no texto do módulo 5. A rematrícula fica com os nossos vídeos: `aula/cap_07b` (Rematrícula, também na Central como "aula-cap-8") e `central/tut_dp` (Incluir DP e adaptação). O suporte a `yt` no player da Central (`central.js`/`server/central.js`) continua, sem uso.
- **Capas novas (20/10, enviadas pelo usuário)**: `capas/aula-cap-8.webp` (Rematrícula — "Continue sua jornada") e `capas/tut_dp.webp` (DP e adaptação — "Entenda como funciona"), 960×540, no estilo das outras capas da Central.
- **Lista de presença removida (20/10, usuário: "isso não existe")**: a dica do módulo 7 e a FAQ `certificado-aula-inaugural` diziam para preencher uma lista de presença com o RGM até 23h59 e que o certificado apareceria no AVA em até 2 dias. Saiu dos dois (e a tag "lista de presença"); fica só o certificado de 4 horas do portal (7 módulos, 70 pontos, no fim da Aula Inaugural). O `videos/nivel7` (aposentado, fora do app) ainda fala do "formulário de presença" na narração.
- **Vídeo "Atividade de Extensão: o que é e como entregar" (`central/tut_extensao`, 20/10)**: 1:26, voz da Roberta com sotaque paulista (a mesma dos vídeos de estágio: ElevenLabs v3, tag "[sotaque paulista, neutro]", stability 0,5; "ODS" escrito "ó dê ésse" na voz e ODS na tela), Avatar IV (mesma foto, ~195 créditos), 20 cenas com telas do AVA recriadas em HTML (nomes fictícios, 2026.2, sem números de ODS, sem pontos nem tentativas) e legenda. Roteiro aprovado; as 2 linhas opcionais (exemplo do brechó falado e "repetir o projeto") ficaram fora porque o áudio completo deu 96 s — o brechó aparece no cartão. Card em `videos.json` (categoria "Aulas", módulo 3, `termos` de busca). Capa `capas/tut_extensao.webp` feita com a Roberta recortada (estilo das capas de estágio), não "pessoa apontando": troque se houver uma capa no padrão das enviadas. Pendentes de confirmação: a data de entrega na tela (22/11/26) é ilustrativa; FAQ "O que é a Atividade de Extensão?" não feita (aguarda o dono).
- **Certificado no modelo novo (20/10, modelo enviado pelo usuário)**: "Certificado de participação" da Cruzeiro do Sul Virtual (faixas azul e dourada). Fundo `public/assets/certificado-modelo.jpg` (1600×1131) = a imagem do modelo sem os valores de exemplo (removidos com textura do próprio fundo; rótulos, linhas e marca ficam na imagem). `public/js/certificate.js` reescrito: página A4 deitada com o fundo e, nas posições medidas, NOME (azul, maiúsculas, encolhe e quebra em 2 linhas se precisar), RGM (pequeno, sob a linha do nome), AULA INAUGURAL, data da aula, "04 HORAS" (`horas`, padrão 4) e "Polo …"; "Emitido em …" discreto no canto. Espaçamento entre letras pelo operador Tc (o texto do PDF continua copiável/pesquisável). Fontes: Montserrat Regular + **Montserrat Bold** (oficial, `public/assets/fonts/Montserrat-Bold.ttf`, licença OFL em `Montserrat-OFL.txt`), as duas embutidas em subconjunto (PDF ~265 KB). `app.js` carrega o fundo e as duas fontes; `tools/test-certificate.js` atualizado (`npm run test:certificate` passa). O template antigo `public/assets/certificado-template.pdf` ficou no repositório, sem uso.
- **Assinatura no certificado (20/10, aprovada pelo usuário)**: `public/assets/certificado-assinatura.png` (PNG transparente) = a assinatura do certificado antigo (Marcelo Pinheiro), recortada da imagem que juntava carimbo, caixas e assinatura (`X8` do `certificado-template.pdf`): tiradas as linhas da caixa e as letras do nome impresso, ampliada 3x. Fica sobre a linha acima do polo, à direita (`LAYOUT.assinatura`, sem encostar na carga horária). `app.js` carrega a assinatura como opcional (se falhar, o certificado sai sem ela). Tem pequenas falhas de traço por vir de uma imagem pequena; para trocar por uma versão melhor, basta substituir o PNG (fundo transparente, ~600 px de largura).
- **Card da Aula Inaugural no Início, foco no certificado (20/10, modelo do usuário)**: painel azul à esquerda com a medalha (SVG em `inicio.js`) e "Certificado de 4 horas"; no meio, rótulo dourado, título do módulo atual ("Módulo 4 de 7: Provas e notas"), o que falta ("Faltam 3 módulos para liberar o certificado."), barra amarelo→laranja e "4 de 7 módulos | 40 de 70 pontos"; à direita, botão azul "Continuar o módulo N" e "Ver os módulos". Mesmo desenho nos estados começar, liberado ("Emitir certificado"), emitido ("Baixar o certificado") e concluído sem RGM. CSS em `painel.css` (`.ai-card`, `.ai-selo`, `.ai-medalha`); abaixo de 1020 px o painel vira faixa no topo e, no celular, o botão ocupa a largura. Os pontinhos por módulo saíram.
- **Série "Estágio" na Central (20/10, sessão de estágio, aprovada pelo usuário)**: 3 vídeos rápidos com a Roberta (voz com sotaque paulista, Avatar IV), telas do CAA Online e do AVA recriadas em HTML com dados fictícios: `central/estagio-comecar` (1:14, Manual, Carta de Apresentação, o que pedir na instituição), `estagio-tce` (1:45, passo a passo do TCE no CAA Online, o erro "Orientação de Estágio" que indefere, acompanhamento) e `estagio-entregar` (1:20, fichas, relatório, TCE assinado em um PDF, Entrega de Documentos). Categoria nova "Estágio", módulo 7; campos `serie`/`parte` em `videos.json` mantêm os três juntos e em ordem na Central, com o selo "Estágio · N de 3" (`server/central.js` repassa os campos; `public/js/central.js` agrupa e ordena). FAQ nova `estagio-como-fazer`. Capas enviadas pelo usuário. ~783 créditos HeyGen. Itens do vídeo-fonte a confirmar com a equipe acadêmica (prazo de 7 a 10 dias do TCE, assinatura física no lugar da digital, INEP só em licenciatura, nomes dos passos iguais em todas as marcas).
- **Primeiros passos do Início (20/10, sessão de estágio, modelo do usuário)**: "Aplicativos para sua jornada" (Duda e Authenticator com as lojas) e "Como podemos ajudar no acesso?" com 4 abas (E-mail e senha · Criar senha · Authenticator · Entrar no Duda), cada uma com "Assistir à orientação" (abre o vídeo do módulo 1 no player da Central) e "Ver orientação completa". O cartão "Seus dados de acesso" foi para dentro da aba "E-mail e senha" (`apps.js`, `dados-acesso.js`, `portal.css`, `dados-acesso.css`); sem RGM, a aba explica a regra da primeira senha. Conferido logado (com e sem RGM) em desktop e 375 px.
- **Remendos dos vídeos dos módulos 2, 3, 4 e 6 (20/10, sessão "Finalizar remendos", aprovados pelo usuário)**: `videos/nivel2`, `nivel3`, `nivel4` e `nivel6` (.mp4/.txt/.vtt/.jpg) sem os nomes antigos ("Trilha", "Nível N", "missão"); ~94 créditos. Originais em `~/Documents/app_alunos-video-backup-2026-10-20/`. Atenção: só os trechos novos usam a voz com sotaque paulista; o meio desses vídeos continua com a voz anterior.
- **"Dicionário do aluno" virou explicação no próprio texto (20/10, opção escolhida pelo usuário)**: saiu o bloco de 24 cartões do fim da Aula Inaugural (`trilha.js`/`trilha.css`). Agora `public/js/glossario.js` (+ `public/css/glossario.css`) marca cada termo do `glossario` do `trilha.json` com sublinhado pontilhado, só na 1ª vez que aparece em cada bloco (um módulo, "Sua primeira semana", "Travou?"), nos textos corridos (tópicos, resumo completo, dica e tarefas; nunca em títulos, botões, links ou no quiz). Tocar abre um balão azul-marinho com o termo em dourado e a mesma explicação de antes; Esc, tocar fora ou tocar de novo fecha. Padrão "toggletip": o termo é `<button aria-expanded>`, e a explicação entra numa região `role="status"` (o leitor de tela anuncia). O balão fica no `<body>` (a tela tem `filter` na animação de entrada, o que quebraria o `position:fixed`), vira para cima perto do rodapé e acompanha a palavra quadro a quadro. O `glossario` ganhou uma 3ª coluna opcional de variantes (plural, nome curto: "Authenticator", "disciplinas", "adaptações", "DPs"…); siglas (A1, A2, AF, DP, MB) só batem em maiúsculas. São 42 marcações hoje; "digitalizar" ainda não aparece em nenhum texto. Testado em 375 px e 1280 px, sem rolagem horizontal.
- **Card de conclusão no fim da Aula Inaugural (20/10, sessão "Novo card de conclusão", modelo do usuário)**: a faixa verde "Você concluiu a Aula Inaugural!" (`#tCert`, `trilha.js` → `certStatus`) virou um card com medalha dourada (SVG em `trilha.js`), "Certificado de 4 horas", rótulo "Aula Inaugural concluída", selo "Concluído"/"Emitido", título "Sua jornada começou com uma conquista!", pílulas com check ("7 de 7 módulos", "70 pontos"), botão "Emitir meu certificado"/"Gerar o PDF de novo" com ícone de download e o link "Rever os módulos →", que rola até "Seus módulos" e põe o foco no título. Estilos `.tcert-ok`/`.tc-*` em `trilha.css`; o estado bloqueado (cadeado) ficou igual.
- **Duas versões das telas do aluno: VERSAO_NOVA_PARA (20/10, pedido do usuário)**: a publicação vai para todos, mas só as contas de `VERSAO_NOVA_PARA` (RGM ou e-mail; `*` = todos; vazia = ninguém) veem as telas novas. As demais veem as telas congeladas da produção de antes (`origin/main` ebc4a25): `public-antigo/` = `index.html` + os 13 JS/CSS que mudaram desde então, servidos em `/antigo/js/...` e `/antigo/css/...` (o `index.html` congelado aponta para lá; o resto, como imagens, vendor, `auth.js` e `config.js`, é igual e vem de `public/`). `server/versao.js` decide; o cookie HttpOnly `app_versao=nova` escolhe só qual `index.html` entregar (`/`, `/index.html` e as páginas do aluno, com `Cache-Control: no-cache` e `Vary: Cookie`). Quem grava o cookie é `GET /api/versao` (autenticado). `public/js/auth.js` (o mesmo nas duas versões) chama essa rota ao abrir a página já logado e depois do login, e recarrega uma vez se a página for da outra versão (`<meta name="app-versao">`; no máximo uma recarga a cada 30 s). O admin é sempre o novo. A Aula Inaugural e a Central (`trilha.liberadaPara`) agora exigem também a conta em `VERSAO_NOVA_PARA`, inclusive a regra "sem RGM vê a Aula", e `liberadaParaTodos` só vale com as duas listas em `*`. Um agente conferiu que as telas antigas funcionam com o servidor novo: as rotas e os campos são os mesmos, e as respostas só ganharam campos. Teste local: conta comum → telas antigas (uma recarga, APIs 200, sem 404); conta de teste → telas novas. Preview com a variável: `app_alunos_versoes` no `.claude/launch.json`. Para liberar a todos depois: `VERSAO_NOVA_PARA=*` (e então `public-antigo/` pode ser apagado).
- **Aplicativos e dados de acesso só no Início (20/10, pedido do usuário)**: "Aplicativos para sua jornada" (Duda e Authenticator), "Como podemos ajudar no acesso?" e os dados do aluno (RGM, e-mail acadêmico, primeira senha) ficam só em `#dashboard-page`. `apps.js` esvazia e oculta os `[data-apps-slot]` das outras telas (Avisos, Central, Atendimento, Meu semestre, Aula Inaugural), e `dados-acesso.js` deixa vazios os `[data-dados-acesso-slot]` fora do Início, inclusive a faixa do módulo 1 e a da Central.
- **Correção do deploy (20/10)**: depois da subida, todas as páginas davam `{"success":false,"message":"Erro interno."}` (500), porque o `Dockerfile` copiava só `public/` e `server/`, e `public-antigo/` não ia para a imagem (o `sendFile` do index antigo falhava). Incluído `COPY public-antigo ./public-antigo`. Lembrete: toda pasta nova que o servidor lê precisa entrar no `Dockerfile`.
- **Entrada dos novos matriculados e acompanhamento (20/10, itens 1 a 4 do plano aprovados pelo usuário)**:
  1. `VERSAO_NOVA_DESDE=AAAA-MM-DD` (`server/versao.js`): contas criadas a partir desse dia (00h de Brasília) veem a versão nova, além das listadas em `VERSAO_NOVA_PARA`. `getSessionAluno` passou a devolver `created_at`. Para o novo matriculado com RGM ter a Aula, `TRILHA_LIBERADA_PARA=*` (a Aula continua exigindo a versão nova, e `liberadaParaTodos` só vale com `VERSAO_NOVA_PARA=*`). Os sinais de busca, vídeo e erro do certificado precisam de `RASTREIO_LIBERADO_PARA=*`.
  2. Login registrado em `csu_alunos.primeiro_login_em`, `ultimo_login_em` e `logins` (`db.createSession`, por onde passam o login e o primeiro acesso). Na primeira vez, `ensureSchema` preenche o histórico pelas sessões e pelos certificados. Sinal novo **"Ainda não entrou no portal"** (`nunca_entrou`, tipo `horas`, padrão 24 h, prioridade 1): conta criada há pelo menos N horas, dentro do período da lista, sem nenhum login. A mensagem tem as variáveis novas `{email}`, `{senha_inicial}` (primeiro nome + "123@", a mesma regra do login) e `{link}` (`APP_PUBLIC_URL`, ou `https://app.cruzeiroead.com.br` se ela não existir).
  3. Funil por coorte: `GET /api/admin/acompanhamento/funil?dias=` (`trilhaRelatorios.funilCoortes`) e uma tabela no topo da aba Acompanhamento. Por dia de criação da conta, mostra contas, entraram, em até 24 h, começaram a Aula, concluíram os 7 módulos e emitiram o certificado. Os dias anteriores a `VERSAO_NOVA_DESDE` aparecem como "versão antiga".
  4. O texto do sinal "Sem acessar há dias" dizia "Área do Aluno" (que é o site da faculdade); agora diz "portal do polo". O texto antigo está em `MENSAGENS_ANTIGAS`, para trocar sozinho onde não foi personalizado.
- **"Não subiu a versão nova" (20/10, relato do usuário)**: de fora, a produção estava certa: com o cookie `app_versao=nova`, a página nova era entregue; `/api/versao` existia; o index antigo carregava o `auth.js?v=8`. Ou seja, o servidor estava respondendo "antiga" para a conta. As causas prováveis são o Environment sem novo Deploy, um valor que não bate com a conta (por exemplo, o e-mail acadêmico, quando o login é pelo pessoal) ou ter olhado só a tela de login, que é sempre a antiga. Para conferir sem abrir o EasyPanel: caixa **"Versão das telas: quem vê a nova"** no topo de Admin › Acompanhamento (`GET /api/admin/versao?q=`). Ela mostra o que o servidor leu (`VERSAO_NOVA_PARA`, `VERSAO_NOVA_DESDE`, se Aula e rastreio estão ligados) e, para até 10 alunos, a versão e o motivo (`versao.motivo`: `todos`, `lista`, `data` ou antiga). Na lista, o RGM agora vale com ou sem pontuação. Também corrigido: `ensureAcompanhamento` passou a rodar `db.ensureSchema`, porque a lista e o funil usam as colunas de login e, logo depois da publicação, elas só existiam após o primeiro login.
- **E-mail acadêmico se descobre pelo site, não pelo Duda (22/10, correção do usuário)**: o caminho certo é **emailacademico.cruzeiroead.com.br/descobrir** (redireciona para sso.cruzeirodosul.edu.br/recover-email): informar o CPF, tocar em Continuar e o e-mail aparece; depois do Continuar vem a tela da Microsoft (parte 2). O "Não sei meus dados de acesso" do Duda, com nome, CPF de novo e seta azul, estava errado.
  - **Vídeos remendados** (roteiros aprovados; voz da Roberta sem sotaque e Avatar IV com a foto dela, 82 créditos, de 927 para 845; dados fictícios: CPF 987.654.321-00, ana.souza@cs.cruzeirodosul.edu.br):
    - `videos/nivel1_parte1`: de 1:46 para 1:20. A produção até 35,9 s, mais o trecho novo do site (20,9 s), mais a 1ª senha refeita com o mesmo avatar do remendo A sobre o site esmaecido, com o cartão dizendo "O site mostra só o e-mail", mais "Anotou? Então toca em Continuar…" (6,8 s).
    - `aula/cap_02`: produção até 12,85 s, mais o trecho novo (9,8 s), mais o cartão "Anote num papel" com a etiqueta "o site mostra" e a frase de baixo trocada, usando o avatar do remendo B a partir de 2,36 s, mais a produção de 33,4 s até o fim.
    - As telas do site foram recriadas em HTML sobre as cenas originais (`onboarding-ead-cruzeiro/.../cenas_html/p1_09` e `aula-nova/.../cap_02_02`), com o endereço grande na etiqueta, porque a narração diz "está aqui na tela e embaixo do vídeo".
    - Scripts em `scratchpad/remendo-email` (cenas.py, legendas.py com "e-mail" que não quebra, segmento2.py com várias telas, emendar.py com corte e vtt). Os vídeos passam por revisão do usuário antes de substituir os de `public/trilha-midia`.
  - **Textos** (`trilha.json`, módulo 1): tópico com link clicável; Parte 1 do resumo; legendas das capturas, que passaram a ser as telas novas `telas/d02s.webp` e `d03s.webp` (o site); pergunta 2 do quiz ("Você ainda não sabe o seu e-mail acadêmico. Onde descobre?", com a certa no mesmo índice 1); "Travei" da parte 1 (o site não mostrou o e-mail). Também `faq.json` (as 2 perguntas de primeiro acesso, com link) e o resumo de `acesso-email-senha` em `videos.json`. A Parte 4 ("Fazer login" no Duda) está certa e ficou como estava.
- **Inserções sobre o presencial de agosto de 2027 e o polo (22/10, aprovadas pelo usuário para gerar; revisão depois)**: o novo marco da EAD (Decreto nº 12.456/2025, Portarias MEC 378/381) traz, a partir de agosto de 2027, provas presenciais nos cursos EaD, e provas e algumas atividades presenciais nos semipresenciais. São duas inserções com a Roberta (Avatar IV, 114 créditos, de 845 para 731), em cartões no estilo da aula (scripts em `scratchpad/insercoes`: `cartoes.py` e `legendas.py` no estilo aula):
  - `aula/cap_06` (Provas e notas), depois de "A data está no Calendário Acadêmico." (corte em 32,55 s): cartão "Novidade: agosto de 2027" (Cursos EaD: provas presenciais; semipresenciais: provas e algumas atividades presenciais; "Você vai receber as orientações com antecedência"), 22,5 s. O capítulo passou de 0:58 para 1:21.
  - `aula/cap_01` (Como funciona o EaD), depois de "Você estuda no seu ritmo…" (corte em 17,75 s): cartão "E o seu polo?" (desconto especial por estar na unidade; presencial só em agosto de 2027, e ainda não se sabe quais polos vão receber as provas; WhatsApp até as 22h; nota 4,8 no Google com quase 4 mil avaliações; "Não precisa mudar de polo agora. Siga o curso."), 28,8 s. O capítulo passou de 0:39 para 1:07.
  - Notas no Google Maps (22/10), unidades com o telefone da rede (11) 91747-9873: Barra Funda 4,8 (1.276), Sapopemba 4,9 (1.055), Vila Prudente 4,9 (814), Santana 2 5,0 (154), Taboão da Serra 4,7 (145), Freguesia do Ó 4,9 (127), Morumbi 4,3 (122), Vila Mariana 4,5 (102), Ibirapuera 5,0 (100), Capivari 4,7 (12), Campinas 2,6 (10). Com outro telefone: Taboão Centro 3,7 (9) e Itapira 5,0 (7). Média ponderada de 4,8 sobre 3.933 avaliações.
  - Textos: FAQ "Provas e notas" ganhou `provas-presenciais-2027` e `mudar-polo-presencial`, e o aviso em `quando-prova`; tópico da A1 do módulo 4. Ao colocar os vídeos no app, atualizar as `duracao` de cap_01 (1:07) e cap_06 (1:21) em `aula-inaugural.json`.
  - Junto: a duração do `acesso-email-senha` em `videos.json` foi de 1:46 para 1:20 (commit b2286bc, já no ar).
- **Inserções refeitas com os roteiros do usuário (22/10)**: as primeiras versões saíram com sotaque nordestino e sem a energia da tutora. O motivo: geradas soltas, sem as etiquetas de emoção. Agora a voz segue a receita da aula (`onboarding-ead-cruzeiro/CONTEXTO.md` e `tutor_aula.py`): o capítulo inteiro numa geração só (eleven_v3, Roberta, stability 0,5), com as etiquetas [warmly], [reassuring], [cheerfully] e [excited] e a fala nova no lugar; depois recorta no meio do silêncio e acelera com `atempo=1.07`. Duas tomadas, prévia com o áudio original antes e depois, e o usuário escolhe (scripts `insercoes/tts-capitulo.js`).
  - `aula/cap_06` (2:08): "Como funcionam as provas?" (tomada B) substitui de 0:25 a 0:35 da versão antiga: portal com Plataforma de Prova e Calendário Acadêmico (tutora no círculo); "Previsão: agosto de 2027" (EaD presencial; semipresencial com provas e atividades); "Você não está sozinho" (datas, locais, cada etapa; aviso com antecedência); a assinatura "Seu compromisso é estudar. O nosso é ajudar você a seguir em frente."; "média 6 ou mais? Parabéns, você passou!" sobre o cartão da nota. No fim, depois de "Minhas Notas - Detalhado", a nota não aparece na hora: o lançamento segue o Calendário Acadêmico (tela de notas com S/N e "Nota ainda não divulgada", depois o calendário). Avatar: 141 + 44 créditos.
  - `aula/cap_01` (1:30): "E o seu polo?" (tomada B, roteiro do usuário): maior rede de polos parceiros, rede de apoio, condições especiais, WhatsApp até as 22h, quase 4 mil avaliações e 4,8 no Google; presencial previsto para agosto de 2027 e locais das provas a definir; não precisa mudar de polo, e a transferência pode alterar descontos e benefícios. Cartões no layout do usuário ("A maior rede" ao lado de "4,8/5"; colunas Até 22h, Apoio humano e Benefícios, entrando com fade na ordem da fala; fechamento "Uma grande rede de polos. Um atendimento próximo de você."). Avatar: 118 créditos. Saldo final do HeyGen: 428.
  - Pendente de confirmação antes de publicar: "a maior rede de polos parceiros da Cruzeiro do Sul" (afirmação do usuário, sem documento).
  - FAQ no mesmo tom: `provas-presenciais-2027` (previsão da operação e prazo de adaptação do MEC), `mudar-polo-presencial` (roteiro do polo), `onde-notas` (divulgação pelo calendário) e o tópico da A1 do módulo 4. Ao publicar, as `duracao` em `aula-inaugural.json` ficam: cap_01 1:30 e cap_06 2:08.
- **Admin reorganizado (28/10)**: o menu virou grupos (lateral a partir de 1024 px; faixa rolável no celular): **Acompanhar** (Quem contatar = ex-"Acompanhamento", Aula Inaugural, Avaliações dos conteúdos), **Alunos** (Acessos dos alunos = ex-"Alunos", Indicações), **Conteúdo do portal** (Avisos, Tutoriais, Contatos por polo) e **Ferramentas** (Imagens dos planos, Configurações). Os `data-tab`, ids e rotas da API não mudaram. Cada aba tem endereço (`#trilha`, `#trilha/onde-trava`, `#config`…), então Voltar/Avançar e links diretos funcionam (`lerRota`/`irPara`/`aplicarRota` em `admin.js`). Aula Inaugural ganhou sub-abas: Resumo, Onde trava (atrito, perguntas, Travei, alunos presos), Por aluno e Uso (as duas últimas montadas por `admin-aula.js` em `#trilha-sub-por-aluno` e `#trilha-sub-uso`). A nova aba **Configurações** (`#tab-config`) reúne as Regras dos sinais (antes num modal; agora formulário em `#config-regras`, `AdminAcomp.loadConfig()`) e a caixa "Versão das telas" (antes no topo de Quem contatar). Avaliações deixou de criar a própria aba: o botão e o `#tab-avaliacoes` estão no `admin.html` e o `admin.js` chama `AdminAvaliacoes.load()`. Conferido com um servidor de teste (sem banco) em 1280 px e 375 px.
