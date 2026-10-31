# Grupo de estudo do curso (moderado por IA)

Status: **MVP oculto**, só local. Liga com `GRUPO_ESTUDO_ATIVA_PARA`. Sem integração com o CRM.

O aluno de EAD sempre pergunta "tem grupo de WhatsApp do meu curso?". A resposta passa a ser "tem, aqui
no app". O grupo é um só por curso, todas as mensagens passam por moderação antes de aparecer e nenhum
dado de contato fica visível. Assim, o grupo não vira porta de saída para o WhatsApp nem balcão de
venda de gabarito.

---

## 1. Quem entra em qual grupo

| Opção | Dados que temos | Prós | Contras |
|---|---|---|---|
| **Por curso** (escolhida) | `csu_alunos.curso` (vem da emissão/derivação e do relatório de matriculados) | Grupo grande o bastante para ter conversa; um dado que já existe para quase todos os ativos | Mistura semestres diferentes |
| Por turma | Não há campo de turma confiável | Mais próximo da sala | Grupos de 3 pessoas, vazios; exige dado novo |
| Por disciplina | `materias_alunos` / `csu_materias_alunos.materias[].disciplina` (com janela de datas) | Conversa muito focada | Muitas salas pequenas; a lista muda todo mês e ainda falta para muitos alunos |

**Decisão:** um grupo por **curso**, nacional (todos os polos do portal), chave = nome do curso
normalizado (sem acento, minúsculo, espaços simples). A filiação é **calculada a cada pedido** a partir de
`csu_alunos.curso`: se o curso muda, o aluno troca de grupo. Ninguém escolhe o grupo nem entra em outro
curso pelo endereço. Aluno sem curso no cadastro vê "Seu curso ainda não chegou ao portal" e não entra
em grupo nenhum.

**Conversa privada 1:1 (decidido em 2026-10-31):** no estilo WhatsApp Web, a lista à esquerda traz o grupo
do curso e os colegas do mesmo grupo. Tocar num colega abre uma conversa privada, que só é possível entre
colegas do mesmo curso e passa pela mesma moderação do grupo. No privado:
- **uma denúncia** já tira a mensagem do ar e a manda para a fila (não há outros membros para somar 3);
- o aluno pode **bloquear** o colega, e quem foi bloqueado não consegue mais mandar mensagem privada;
- a equipe só lê as mensagens privadas que foram denunciadas, retidas ou bloqueadas pelo moderador.

Próximo passo natural: **salas por disciplina dentro do grupo do curso** (ver §7), usando a lista de
disciplinas de `csu_materias_alunos`.

## 2. Identidade e privacidade (LGPD)

- Nome exibido: **primeiro nome + inicial do sobrenome** ("Maria S."), calculado no servidor. A API do
  grupo nunca devolve RGM, e-mail, telefone, polo nem `aluno_id` de outro aluno. Cada mensagem traz só
  `autor` (o nome exibido) e `minha: true/false`. Na lista de conversas, cada colega é identificado por uma
  **referência aleatória** (`csu_grupo_membros.ref`), não pelo id.
- Apelido (sugestão §7): se for criado, passa pela mesma moderação que as mensagens.
- **O moderador bloqueia dado pessoal**: telefone (inclusive por extenso ou em emoji de número), e-mail
  (inclusive "fulano arroba gmail ponto com"), CPF, RG, RGM ou matrícula com número, senha, endereço, data de
  nascimento, "me chama no zap/pv", links de WhatsApp/Telegram, @ e "me segue no insta". A explicação é
  gentil: "Para sua segurança, não compartilhe…".
- **Fotos** são regravadas no servidor (WebP, até 1600 px) **sem metadados**: EXIF, GPS, câmera e data
  saem antes de gravar.
- **Fotos e áudios ficam por `GRUPO_MIDIA_DIAS` (padrão 7) e depois são apagados do disco.** A mensagem
  continua, com "Foto apagada" e a legenda. Um aviso na lista de conversas, nas boas-vindas, na hora de
  enviar a foto e na gravação de áudio diz isso ao aluno.
- **Guardado:** texto da mensagem, autor, curso, resultado da moderação (categoria, motivo, quem decidiu)
  e denúncias. Mensagens bloqueadas ficam guardadas para auditoria e só o próprio autor e o admin as veem.
  Retenção: 180 dias, igual a `RASTREIO_RETENCAO_DIAS`, com limpeza automática.
- **`csu_eventos` recebe só metadados** (categoria, ação, id da mensagem), nunca o texto.
- Com o Anthropic ligado, o texto da mensagem vai para a API, **sem nome, RGM nem curso**. Isso precisa
  entrar na política de privacidade antes de abrir para todos.

### 2.1 Aceite das regras (termo versionado)

- **Na primeira entrada**, antes de ver qualquer conversa, o aluno vê "Antes de entrar no grupo": seis
  regras em linguagem simples, cada uma com a **base legal**, mais o termo completo expansível. Ele marca
  "Li e aceito as regras do grupo e o uso dos meus dados descrito acima" e toca em "Aceitar e entrar no
  grupo". "Agora não" volta ao Início.
- **Texto** em `server/grupo-termo.js`, num arquivo à parte para o jurídico revisar. Seções:
  1. o que é o grupo;
  2. regras de convivência;
  3. como funciona a moderação;
  4. seus dados (LGPD);
  5. mudanças no termo.
- **Bases citadas:**

  | Tema | Lei |
  |---|---|
  | Honra (calúnia, difamação, injúria) | Código Penal, arts. 138 a 140 |
  | Intimidação sistemática, inclusive virtual | Código Penal, art. 146-A (Lei 14.811/2024) |
  | Ameaça e perseguição | Código Penal, arts. 147 e 147-A |
  | Divulgação de nudez sem consentimento | Código Penal, art. 218-C |
  | Fraude em exames previstos em lei (ex.: ENADE) | Código Penal, art. 311-A |
  | Racismo e injúria racial | Lei 7.716/1989; STF, ADO 26 (homotransfobia) |
  | Dados pessoais | LGPD (Lei 13.709/2018), arts. 6º, 7º I e IX, 9º, 15 e 18 |
  | Ordem judicial, guarda de registros e informação ao usuário | Marco Civil da Internet (Lei 12.965/2014), arts. 7º, 10 e 15 |
  | Direito de imagem | Código Civil, art. 20 |
  | Direitos autorais | Lei 9.610/1998 |
  | Intimidade e vida privada | Constituição Federal, art. 5º, X |

- **Versão:** `VERSAO` em `server/grupo-termo.js` (hoje `2026-10-31`). Trocou a versão, todo aluno aceita
  de novo antes de voltar a usar o grupo.
- **Registro:** tabela `csu_grupo_aceites` (aluno, versão, data e hora) e evento `grupo_aceite` em
  `csu_eventos`.
- **No servidor:** sem aceite da versão atual, todas as rotas de `/api/grupos/*` respondem
  `403 aceite_pendente`, exceto `/meu` e o próprio aceite. Quem não aceitou **não aparece na lista dos
  colegas** e não pode receber mensagem privada.
- **Depois do aceite:** o termo completo fica em Regras › "Ler o termo completo", em toda conversa.
- **Pendências para o jurídico:**
  - revisar o texto e as bases legais;
  - confirmar a base legal da LGPD (consentimento para participar, legítimo interesse para moderar);
  - confirmar se o portal precisa guardar registros de acesso por 6 meses (Marco Civil, art. 15) e onde
    eles ficam (proxy/EasyPanel), já que o grupo não grava IP;
  - definir a regra para alunos menores de 18 anos (LGPD, art. 14);
  - incluir um botão "Sair do grupo / revogar consentimento". Hoje a revogação é pelo atendimento, e o
    servidor já respeita a remoção do aceite no pedido seguinte.

## 3. Moderação antes da publicação

Toda mensagem passa por este caminho **antes** de aparecer para os outros:

```
texto ─► limites (500 caracteres, 6 por minuto, repetida) ─► regras baratas (regex) ─┬─ bloqueio certo ──► bloqueada (com explicação)
                                                                                      └─ resto ──► classificador (LLM ou stub)
                                                                                                   ├─ ok ─────────► publicada
                                                                                                   ├─ categoria ──► ação da tabela
                                                                                                   └─ falhou ─────► fallback
```

### 3.1 Categorias e ações

| Categoria | Exemplos | Ação | O autor vê |
|---|---|---|---|
| `fraude_academica` | "vendo gabarito", "quem tem as respostas da prova?", "faço seu TCC", "passo cola no pix" | **Bloquear** (com confiança baixa, **segurar**) | "Não dá para combinar prova, gabarito ou trabalho pronto aqui. Isso pode anular a sua prova. Que tal postar a dúvida da matéria?" |
| `assedio` | palavrão, xingamento, ofensa a um colega, cantada | **Palavrão e xingamento: bloquear direto** (regra). Ofensa grave pelo classificador: bloquear e mandar para a fila | "Palavrões, xingamentos e ofensas não são publicados. Que tal reescrever com outras palavras?" |
| `odio` | ataque por raça, religião, gênero, orientação, deficiência | **Bloquear e mandar para a fila** (revisão obrigatória, possível silenciamento) | "Essa mensagem vai contra as regras do grupo e não foi publicada." |
| `dados_pessoais` | telefone, e-mail, CPF, "me chama no zap", link do WhatsApp | **Bloquear** | "Para sua segurança, não compartilhe telefone, e-mail ou outro contato no grupo." |
| `spam` | link externo, propaganda, "promoção", pix, repetição | **Bloquear** | "Links e anúncios não são publicados no grupo." |
| `fora_de_tema` | conversa leve, "bom dia", futebol | **Permitir** (comunidade também é conversa leve) | (publicada) |
| `ok` | dúvida, ajuda, material, combinados de estudo | **Publicar** | (publicada) |

**Por que "fora de tema" passa:** o grupo substitui o WhatsApp, e lá o "bom dia, turma" é o que cria
vínculo. Bloquear isso afasta as pessoas. Se o volume de conversa fora do tema atrapalhar, a alavanca
seguinte é a "dúvida da semana" fixada, e não o bloqueio.

### 3.2 Regras baratas (antes do LLM)

Ficam em `server/grupo-moderacao.js` e rodam sobre o texto normalizado (minúsculas, sem acento, `0→o`,
`1→i`, `3→e`, `4→a`, `@→a`, `$→s`, sem separadores entre dígitos):

- **Telefone:** 8 a 13 dígitos seguidos depois de tirar espaço, ponto, traço e parênteses; também "9 9999 9999" e "(11)9…". → `dados_pessoais`
- **E-mail e CPF.** → `dados_pessoais`
- **"zap", "whats", "wpp", "telegram", "pv", "privado", "me chama", "insta", "@usuario".** Sozinhos, viram sinal; junto com "chama", "manda" ou "add", bloqueiam. → `dados_pessoais`
- **Link:** `http`, `www.` ou `algo.com/.br/.net/.ly/...`, exceto os domínios da instituição (`cruzeirodosulvirtual.com.br`, `cruzeiroead.com.br`). → `spam`
- **Fraude, bloqueio certo:** verbo de comércio ou oferta ("vendo", "vende", "compro", "passo", "tenho", "consigo", "alguem tem", "quem tem", "faço", "fazemos") a até 40 caracteres de "gabarito", "respostas da prova/av/avaliação", "prova", "tcc", "trabalho", "atividade" ou "cola"; ou "pix" junto de um termo acadêmico. → `fraude_academica`
- **Fraude, só sinal:** "gabarito" ou "cola" sozinhos ("o gabarito oficial saiu?"). Vai para o LLM; se ele falhar, a mensagem é **segurada**.
- **Spam:** "pix", "promoção", "desconto", "renda extra", "clique", 6 letras iguais seguidas, ou a mesma mensagem do mesmo autor em 10 min. → `spam`
- **Palavrões e xingamentos (bloqueio direto, sem ir para a fila):** lista de palavrões e xingamentos comuns, tolerante a letra repetida ("merdaaa"), vogal trocada por `*` ("p*rra") e leet ("c4r4lho"), sempre como palavra inteira ("computador" e "disputa" passam). "Burro", "lixo", "ridículo"… só bloqueiam quando dirigidos a alguém ("você é burro", "seu lixo"): "sou burro em cálculo" passa. → `assedio`
- **Dados sensíveis além de telefone/e-mail:** número junto de CPF/RG/RGM/CNH/matrícula/cartão/CEP; "meu cpf/rg/rgm/senha"; endereço ("moro na…", "rua X 123"); data de nascimento; telefone por extenso (7+ números falados); e-mail por extenso; "me segue no insta". → `dados_pessoais`
- **Limites:** até 500 caracteres; até 6 mensagens por minuto por aluno; aluno silenciado não envia ("Você está sem enviar mensagens até dd/mm hh:mm").

### 3.3 Classificador (LLM)

Interface `classificar(texto) → { categoria, confianca: 'alta'|'media'|'baixa', motivo }`, com dois
provedores em `server/grupo-moderacao.js`:

- **`stub` (padrão local):** determinístico, baseado em listas de palavras (ofensas, termos de ódio,
  fraude ampla). Serve para testar o fluxo inteiro sem chave e sempre devolve o mesmo resultado para o
  mesmo texto.
- **`anthropic`:** liga quando `GRUPO_MODERACAO_PROVEDOR=anthropic` e `ANTHROPIC_API_KEY` existem e o
  pacote `@anthropic-ai/sdk` está instalado (`npm i @anthropic-ai/sdk`, ainda não está no
  `package.json`). Modelo `GRUPO_MODERACAO_MODELO`, padrão `claude-opus-5-5`, com `effort: low`.
  O `claude-haiku-5-5` é bem mais barato para classificação e fica a critério de vocês.
  A saída é estruturada (`output_config.format` com JSON schema, só as categorias acima) e o fallback
  do lado do servidor fica ligado (`fallbacks: "default"`). O texto do aluno vai entre marcadores e
  como dado: o prompt de sistema diz para não seguir instruções que estejam dentro dele.
- **Tempo máximo:** 6 s (`GRUPO_MODERACAO_TIMEOUT_MS`).

### 3.4 Fotos e áudios

- **Foto:** a legenda passa pela moderação de texto (se ela barrar, a foto nem é guardada). Com o
  provedor `anthropic`, a imagem é classificada pelo Claude (texto visível com telefone, documento, prova
  ou gabarito fotografado, nudez, propaganda). **Com o `stub` (hoje), toda foto vai para a equipe** e
  aparece "em análise" para o autor.
- **Áudio:** **sempre vai para a equipe**, porque não há transcrição. Para liberar áudio automaticamente,
  é preciso um serviço de transcrição (sugestão §7).
- **Limites:** foto em JPG, PNG ou WebP, reduzida no aparelho para até 1600 px; áudio de até 2 minutos
  (4 MB), gravado no navegador (WebM/Opus ou MP4 no Safari). O tipo do arquivo é conferido pelos
  primeiros bytes, não só pelo nome.
- **Arquivos** ficam em `GRUPO_MIDIA_DIR` (padrão `data/grupo-midia`, fora do git), com nome aleatório.
  São servidos só a quem está na conversa (`/api/grupos/midia/:id`, com sessão) e ao admin. Uma limpeza
  roda a cada hora e na subida: apaga o que venceu e o que a equipe removeu.

### 3.5 Fallback se o LLM falhar

Vale para erro, tempo esgotado, recusa ou resposta fora do schema:

- Se a mensagem teve algum **sinal** nas regras (ex.: "gabarito" sozinho, "zap" sozinho), ela é **segurada para revisão**.
- Se não teve sinal nenhum, é **publicada** (`moderador = 'fallback'`) e fica marcada para auditoria no admin.
- Com `GRUPO_MODERACAO_FALHA=reter`, toda mensagem é segurada quando o LLM falha. Use quando o grupo
  estiver grande e o risco pesar mais que a demora.

O risco principal (contato, link, venda de gabarito) é coberto pelas regras, que não dependem do LLM.

## 4. Moderação humana

- **Fila no admin** (Acompanhar › Grupos de estudo):
  - **Precisa de decisão:** retidas (fotos, áudios, mensagens ambíguas, 3 denúncias no grupo ou 1 no
    privado) e bloqueios graves (ódio, assédio forte), as mais antigas primeiro. Foto e áudio aparecem
    no cartão; mensagens privadas trazem "Conversa privada · para Fulano".
  - **Denunciadas:** publicadas com 1 ou mais denúncias. Com 3 denúncias de pessoas diferentes, a
    mensagem sai do ar sozinha e vai para a fila.
  - **Bloqueadas recentes:** auditoria do que o robô barrou, para achar falso positivo.
- **Ações:** Publicar (aprovar), Remover, Silenciar o autor (24 h ou 7 dias, opcionalmente removendo a
  mensagem) e Descartar denúncias.
- **Registro em `csu_eventos`** com `aluno_id` = autor e `nome` = `grupo_moderacao`. `dados` leva `acao`,
  `mensagem_id`, `categoria`, `admin_id` e `origem` (`humano`, `regra`, `llm`, `stub`, `fallback`,
  `denuncia`). O texto não entra. Bloqueios e retenções automáticos também são registrados, com
  `nome` = `grupo_mensagem_moderada`.
- **Denúncia pelo aluno:** botão "Denunciar" em mensagem de outra pessoa, com motivo (fraude, ofensa,
  dado pessoal, spam, outro). Uma denúncia por pessoa por mensagem.

## 5. Tempo real: polling

**Polling a cada 5 s**, só com a tela do grupo aberta e a aba visível (`document.visibilityState`).
O cliente pede a lista (`GET /api/grupos/meu/conversas`, com não lidas) e a conversa aberta
(`…/mensagens?desde=<cursor>`). A tela só é redesenhada quando algo mudou de fato.

Por que não SSE ou WebSocket agora:

- O servidor é Express puro, sem camada de pub/sub; o deploy fica atrás do proxy do EasyPanel. SSE
  exigiria manter uma conexão aberta por aluno, desligar o buffer do proxy e ter um canal entre
  processos (LISTEN/NOTIFY do Postgres) para avisar das mensagens novas.
- A conversa é lenta: a moderação já segura a mensagem antes de ela existir para os outros. Um atraso de
  até 5 s não se nota num grupo de estudo.
- O polling não guarda estado, funciona atrás de qualquer proxy e custa uma consulta indexada
  (`grupo_id, id`) por aluno ativo a cada 5 s.
- **Gatilho para trocar por SSE + LISTEN/NOTIFY:** mais de uns 300 alunos simultâneos na tela do grupo,
  ou se as respostas em "tempo real" passarem a importar (ex.: encontro ao vivo).

## 6. O que o MVP tem

- Flag `GRUPO_ESTUDO_ATIVA_PARA` (RGM ou e-mail, separados por vírgula; `*` = todos; vazio = ninguém),
  no mesmo padrão de `AJUDA_ATIVA_PARA`. Desligada, o menu não mostra nada e `/api/grupos/*` e
  `/api/admin/grupos/*` respondem 404.
- Tela `/grupo` no estilo **WhatsApp Web**, pensada para o celular:
  - **Celular:** a lista de conversas vem primeiro. A conversa ocupa a tela inteira, com voltar (inclusive o
    botão do aparelho).
  - **Desktop:** lista à esquerda e conversa à direita.
  - **Lista:** o grupo do curso e os colegas, com prévia, hora, não lidas e busca.
  - **Conversa:** balões agrupados por autor e por dia; "Verificando…" enquanto o moderador decide; a
    explicação da mensagem bloqueada (só o autor vê); "em análise"; denúncia pelo menu ⋯ (folha que sobe
    de baixo); bloqueio no privado.
  - **Escrever:** emojis, foto (com legenda e prévia) e áudio (até 2 min).
  - **Avisos:** de privacidade e dos 7 dias.
- Entrada para o grupo no Início, logo abaixo do banner (no celular o menu do topo esconde "Grupo").
- Admin › Grupos de estudo: fila de retidas, denunciadas e bloqueadas recentes, com as ações acima.
- Tabelas `csu_grupos`, `csu_grupo_membros` (silenciamento, `ref`, lido até), `csu_grupo_mensagens`
  (grupo e privado, com as colunas de mídia), `csu_dm_conversas`, `csu_dm_bloqueios` e `csu_grupo_denuncias`, criadas sob demanda (`CREATE TABLE IF NOT EXISTS`), como o resto do projeto.
- Seed local `tools/seed-grupo-estudo.js` com dois alunos fictícios no curso do aluno de teste. Recusa
  rodar fora de `localhost`.

## 7. Sugestões priorizadas (depois do MVP)

| # | Recurso | Por quê | Esforço |
|---|---|---|---|
| 1 | **Responder a uma mensagem** (citação) e **"Isso me ajudou"** em respostas | Transforma conversa em dúvida resolvida; é a base de tudo abaixo | P |
| 2 | **Dúvidas resolvidas fixadas** (perguntas e respostas): o autor ou o tutor marca a melhor resposta e o par sobe para "Perguntas do curso" | Diminui pergunta repetida; vira FAQ viva do curso | M |
| 3 | **Dúvida da semana** fixada pela equipe (ex.: "Como vocês estão se organizando para a AV1?") | Puxa conversa útil e dá rumo ao grupo | P |
| 4 | **Salas por disciplina do mês** (abas dentro do grupo, a partir de `csu_materias_alunos`) | Conversa focada na matéria que o aluno está cursando agora | M |
| 5 | **Lembrete de prova junto com regra de integridade** ("Semana de AV: combinar respostas anula a prova") | Prevenção no momento de maior risco de fraude | P |
| 6 | **Encontros de estudo agendados** (data, tema, link só de domínio oficial ou sala do polo) | Recria o "grupo de estudo" de verdade, com hora marcada | M |
| 7 | **Apelido moderado** e foto padrão por curso | Identidade sem expor nome completo | P |
| 8 | **Resumo da semana por IA** ("o que o grupo discutiu e as dúvidas que ficaram sem resposta"), para o aluno e para a equipe | Mostra à coordenação onde a turma trava | M |
| 9 | **Aviso de mensagem nova** no sino de avisos e no Início | Traz o aluno de volta | P |
| 10 | **Tempo real com SSE + LISTEN/NOTIFY** | Só quando o volume pedir (§5) | M |
| 11 | **Moderador com contexto** (ver as 5 mensagens anteriores para entender ironia ou réplica) | Menos falso positivo em assédio | P |
| 12 | **Transcrição de áudio** (ex.: Whisper) para moderar o áudio pelo texto | Áudio sem esperar a equipe; hoje todo áudio vai para a fila | M |
| 13 | **Foto moderada pela IA** (ligar o provedor `anthropic`, já pronto) | Foto sem esperar a equipe | P |
| 14 | **Figurinhas e reações** (👍 numa mensagem, sem texto) | Menos "kkk"/"valeu" soltos na conversa | P |

## 8. Riscos e pendências

- **Classificador (decidido em 2026-10-31):** fica o `stub` durante o piloto oculto. O adaptador
  Anthropic continua pronto no código e liga com `GRUPO_MODERACAO_PROVEDOR=anthropic`,
  `ANTHROPIC_API_KEY` e `npm i @anthropic-ai/sdk`. Rever antes de abrir para mais alunos: o stub só
  reconhece listas de palavras, então ironia, ofensa indireta e fraude com outras palavras passam ou
  ficam retidas.
- **Falso positivo em "prova"/"trabalho":** "alguém tem dica para a prova?" deve passar. As regras só
  bloqueiam a combinação de verbo de comércio ou oferta com termo de avaliação; o resto vai para o
  classificador.
- **Moderação humana tem dono?** Alguém precisa olhar a fila todo dia útil. Com o `stub`, **toda foto e
  todo áudio** passam por ela. Sem dono, a mídia fica "em análise" para sempre e o aluno desiste.
- **Conversa privada** é onde assédio e "me chama no zap" mais acontecem. A moderação prévia e o bloqueio
  ajudam, mas acompanhar as denúncias privadas no piloto é obrigatório.
- **Disco em produção:** `GRUPO_MIDIA_DIR` precisa apontar para um volume persistente (ex.:
  `/data/grupo-midia` no EasyPanel). A limpeza de 7 dias segura o tamanho; a estimativa é de cerca de
  300 KB por foto e 250 KB por minuto de áudio.
- **LGPD:** citar o grupo e o envio do texto ao provedor de IA na política de privacidade antes de `*`.
- **Termo de uso:** feito (§2.1), mas ainda é **rascunho**. O jurídico precisa revisar antes de produção.
