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

Próximo passo natural: **salas por disciplina dentro do grupo do curso** (ver §7), usando a lista de
disciplinas de `csu_materias_alunos`.

## 2. Identidade e privacidade (LGPD)

- Nome exibido: **primeiro nome + inicial do sobrenome** ("Maria S."), calculado no servidor. A API do
  grupo nunca devolve RGM, e-mail, telefone, polo nem `aluno_id` de outro aluno. Cada mensagem traz só
  `autor` (o nome exibido) e `minha: true/false`.
- Apelido (sugestão §7): se for criado, passa pela mesma moderação que as mensagens.
- **O moderador bloqueia dado pessoal**: telefone, e-mail, CPF, "me chama no zap/pv", links de
  WhatsApp/Telegram e @ de rede social. A explicação é gentil: "Para sua segurança, não compartilhe
  contato no grupo".
- **Guardado:** texto da mensagem, autor, curso, resultado da moderação (categoria, motivo, quem decidiu)
  e denúncias. Mensagens bloqueadas ficam guardadas para auditoria e só o próprio autor e o admin as veem.
  Retenção: 180 dias, igual a `RASTREIO_RETENCAO_DIAS`, com limpeza automática.
- **`csu_eventos` recebe só metadados** (categoria, ação, id da mensagem), nunca o texto.
- Com o Anthropic ligado, o texto da mensagem vai para a API, **sem nome, RGM nem curso**. Isso precisa
  entrar na política de privacidade antes de abrir para todos.

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
| `assedio` | ofensa direta a um colega, insistência, cantada | **Segurar para revisão** (com confiança alta, bloquear) | "Sua mensagem está em análise pela equipe." |
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

### 3.4 Fallback se o LLM falhar

Vale para erro, tempo esgotado, recusa ou resposta fora do schema:

- Se a mensagem teve algum **sinal** nas regras (ex.: "gabarito" sozinho, "zap" sozinho), ela é **segurada para revisão**.
- Se não teve sinal nenhum, é **publicada** (`moderador = 'fallback'`) e fica marcada para auditoria no admin.
- Com `GRUPO_MODERACAO_FALHA=reter`, toda mensagem é segurada quando o LLM falha. Use quando o grupo
  estiver grande e o risco pesar mais que a demora.

O risco principal (contato, link, venda de gabarito) é coberto pelas regras, que não dependem do LLM.

## 4. Moderação humana

- **Fila no admin** (Acompanhar › Grupos de estudo):
  - **Retidas:** esperando decisão, as mais antigas primeiro.
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
O cliente pede `GET /api/grupos/meu/mensagens?depois=<último id>`.

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
- Tela `/grupo` com o grupo do curso: as regras fixadas no topo, a lista de mensagens, o envio com
  moderação prévia, a explicação da mensagem bloqueada (só o autor vê), o "em análise" e a denúncia.
- Admin › Grupos de estudo: fila de retidas, denunciadas e bloqueadas recentes, com as ações acima.
- Tabelas `csu_grupos`, `csu_grupo_membros` (silenciamento), `csu_grupo_mensagens` e
  `csu_grupo_denuncias`, criadas sob demanda (`CREATE TABLE IF NOT EXISTS`), como o resto do projeto.
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

## 8. Riscos e pendências

- **Chave do LLM:** não há chave de LLM no `.env`. O MVP roda com o `stub`. Falta decidir o provedor e
  a chave (Anthropic pronto no código, faltando `npm i @anthropic-ai/sdk` e a chave no Environment).
- **Falso positivo em "prova"/"trabalho":** "alguém tem dica para a prova?" deve passar. As regras só
  bloqueiam a combinação de verbo de comércio ou oferta com termo de avaliação; o resto vai para o
  classificador.
- **Moderação humana tem dono?** Alguém precisa olhar a fila todo dia útil. Sem isso, as mensagens
  retidas envelhecem e o aluno desiste.
- **LGPD:** citar o grupo e o envio do texto ao provedor de IA na política de privacidade antes de `*`.
- **Termo de uso do grupo:** aceite na primeira entrada ("Li as regras"). Sugestão para antes de produção.
