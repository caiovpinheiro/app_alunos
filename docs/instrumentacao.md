# Instrumentação do App do Aluno

Atualizado em 06/11/2026 (frente C do `docs/plano-ativacao-2026-11.md`). O que o portal registra, onde cada número aparece no admin e como ler a aba **Medição**.

## Regras

- Nada digitado pelo aluno entra em evento. A única exceção é antiga: o termo da busca da Central (`central_busca`, `faq_aberta.busca`), mascarado no pedido de ajuda quando tem 6+ dígitos.
- Nenhum dado pessoal novo: a origem `?o=` é um código de campanha; a falha de login guarda só o motivo, a hora e o id da conta quando o RGM ou e-mail digitado bate com uma.
- Eventos do navegador só gravam para quem está em `RASTREIO_LIBERADO_PARA` (hoje `*`). Entradas e falhas de login gravam para todos, porque antes do login não se sabe quem é o aluno.
- Retenção: eventos, acessos, entradas que não são a primeira e falhas de login são apagados depois de `RASTREIO_RETENCAO_DIAS` (padrão 180). A primeira entrada de cada conta fica: ela é a origem do primeiro acesso.

## Tabelas

| Tabela | O que guarda | Quem grava |
|---|---|---|
| `csu_acessos` | uma linha por acesso (aba até 30 min parada): início, fim, tempo ativo, telas, cliques, aparelho | `server/acompanhamento.js` (lote do `rastreio.js`) |
| `csu_eventos` | eventos do navegador (`nome`, `tela`, `dados` com até 12 chaves simples) | `server/acompanhamento.js`; `trilha_reiniciada` vem do servidor |
| `csu_avaliacoes` | joinha (`video`, `faq`, `aula`) e, desde 06/11/2026, "Conseguiu fazer?" (`tipo = 'pratica'`, id `modulo:N`, `video:<id>` ou `faq:<id>`; 1 = deu certo, -1 = não funcionou) | `server/avaliacoes.js` |
| `csu_entradas` | login ou cadastro que deu certo: aluno, origem (`?o=`), se foi a primeira entrada da conta, por onde (login ou cadastro) | `server/instrumentacao.js`, chamado em `POST /api/auth/login` e `/register` |
| `csu_login_falhas` | login recusado ou toque em "Esqueci minha senha": motivo, origem, hora, id da conta quando identificada | `server/instrumentacao.js` (`POST /api/auth/login` e `POST /api/auth/esqueci`) |
| `csu_pedidos_ajuda` | pedidos de ajuda (aceitar a oferta), com atendido e resolvido | `server/ajuda-pedidos.js` |

O "Conseguiu fazer?" fica fora do placar de Avaliações, do índice 👍 da Visão geral e das joinhas por aluno: não é avaliação do conteúdo, é resultado.

## Eventos

Rótulos do percurso do aluno em `public/js/admin-acompanhamento.js` (`NOMES_EVENTO`, `descricaoNova`). Os marcados com **novo** entraram em 06/11/2026.

| Evento | Quando | Dados |
|---|---|---|
| `tela_aberta`, `clique`, `saiu` | navegação | `alvo`, `destino`, `externo` |
| `video_inicio`, `video_progresso`, `video_pausa`, `video_retomado`, `video_fim` | qualquer `<video>` | `video`, `titulo`, `pct` |
| `trilha_nivel_aberto`, `trilha_video_assistido`, `trilha_video_pulado`, `trilha_travei`, `trilha_resposta`, `trilha_nivel_concluido`, `trilha_tarefa` | Aula Inaugural | `nivel`, `parte`, `acertou`... |
| `aula_aberta_apos_login` | quem não começou a Aula é levado a ela ao entrar | — |
| `aula_cartao_exibido` **novo** | o cartão do topo da Aula aparece (uma vez por estado a cada vez que a tela monta) | `estado` (`comecar`, `continuar`, `certificado`), `modulo` |
| `aula_cartao_clicado` | toque no cartão do topo | `estado`, `modulo` |
| `aula_pratica_escolha` | módulo 1: "Fazer agora" ou "Fazer depois" | `escolha` |
| `aula_preferencia` **novo** | "A+ Letra maior", "Vídeos mais devagar", "Ver tudo sem jogar" | `preferencia` (`letra_maior`, `video_devagar`, `ver_tudo`), `ligado` |
| `trilha_reiniciada` **novo** | "Começar de novo", gravado no servidor antes de apagar o progresso | `modulos_concluidos`, `modulos_mexidos`, `pontos` |
| `resultado_pratico` **novo** | "Deu certo" ou "Não funcionou" no fim do módulo, do vídeo da Central ou da resposta da FAQ | `conteudo` (número do módulo ou id), `tipo` (`modulo`, `video`, `faq`), `resolveu`, `titulo` (nosso texto) |
| `saida_externa` **novo** | toque (ou botão do meio) num link para o sistema da faculdade, em qualquer tela | `destino`, `tela`, `modulo` (quando o link está num módulo) |
| `central_video` | abriu vídeo da Central | `id` (**novo**), `video`, `categoria`, `tema` |
| `faq_aberta` | abriu resposta da FAQ | `id` (**novo**), `pergunta`, `busca` |
| `central_busca`, `central_busca_sem_resultado` | busca na Central | `termo`, `resultados` |
| `ajuda_oferecida`, `ajuda_recusada`, `ajuda_aceita`, `pedido_ajuda` | oferta "Quer falar com a equipe?" | `origem` (inclui **`nao_funcionou`**), `nivel`, `automatica`, `protocolo` |
| `certificado_gerado`, `certificado_erro`, `aviso_lido`, `whatsapp_clicado` | — | — |

### Destinos de `saida_externa`

Lista única em `public/js/rastreio.js` (`DESTINOS`), testada contra os links de `meu-semestre.js`, `apps.js`, `index.html`, `trilha.json` e `faq.json`:

| `destino` | Host |
|---|---|
| `ava` | `ava.cruzeirodosul.edu.br` |
| `area_aluno` | `novoportal.cruzeirodosul.edu.br` |
| `email_academico` | `emailacademico.cruzeiroead.com.br`, `outlook.office.com`, `outlook.office365.com` |
| `loja_duda` | App Store e Google Play, só o app Duda (`id6451416655`, `br.com.cruzeirodosulvirtual`) |
| `loja_authenticator` | App Store e Google Play, só o Microsoft Authenticator |

Link novo para o sistema da faculdade: acrescentar o host aqui e em `DESTINOS` de `server/medicao.js` (rótulo).

## Origem do acesso (`?o=`)

- Links da régua e das campanhas: `https://app.cruzeiroead.com.br/?o=bv`, `?o=reenvio`, `?o=polo` (minúsculas, números, `_` e `-`, até 24 caracteres; o resto vira "sem origem").
- O portal lê `?o=` ao carregar (`public/js/api.js`), guarda na aba (`sessionStorage`) porque a navegação troca o endereço para `/login`, e manda no `POST` do login ou do cadastro. Depois do login, apaga.
- Quem já está logado e abre o link não passa pelo login: essa visita não entra em `csu_entradas`.
- Origens da régua do calouro (`bv_acesso`, `bv`, `bv_lembrete`, `bv_curso`, `cert`, `cert_erro`): ver `docs/regua-calouro.md`.
- Entrada pelo link pessoal grava `via = link`; tocar de novo no mesmo aparelho grava `via = link_de_novo` (desde 06/11/2026). Falhas do link: `link_usado` (outro aparelho ou trocado por um link novo), `link_expirado`, `link_invalido`.

## Aba Medição (`/admin#medicao`)

`GET /api/admin/medicao?dias=7|30|90` (`server/medicao.js`, guardado por 30 s). Conta só as contas criadas a partir de `contar_desde` (Configurações › Faixas). Sem faixa Bom/Regular/Ruim: estes números ainda não têm meta. "Poucos dados" = menos de 5 alunos, como na Visão geral.

- **Retenção**: coortes por semana (segunda a domingo) de criação da conta, últimas 12 semanas. Só contas com acesso em `csu_acessos` (rastreadas). D0 = primeiro dia com acesso; "voltou até D+N" = outro dia com acesso entre D+1 e D+N. Cada conta só conta quando o prazo dela terminou (hoje não conta); a coorte só entra na comparação quando a semana terminou há mais de N dias.
- **Conseguiu fazer?**: base = quem concluiu o módulo, abriu o vídeo ou abriu a dúvida no período, depois da primeira resposta já gravada (antes disso a pergunta não existia). Quem respondeu sem estar na base também conta. "5 piores" = maior parte de "Não funcionou", primeiro os que têm 5+ respostas.
- **Saídas**: por destino e por onde o aluno estava (módulo ou tela). Módulo 1: de quem tocou em "Fazer agora", quantos saíram para a faculdade, e para o AVA, em até 24 h do primeiro toque.
- **Ajuda**: oferecida e recusada vêm dos eventos; aceita, atendida e resolvida, dos pedidos. Tempos medianos a partir do pedido. Pedido pelo painel não tem oferta e fica fora da taxa de aceite do total.
- **Entrada**: origem do primeiro acesso por coorte ("antes da medição" = primeira entrada anterior à gravação da origem), entradas do período por origem e falhas de login por dia e motivo.

## Testes

- `node tools/test-instrumentacao.js`: contas da Medição, limpeza da origem, gravação sem o que foi digitado, tipo `pratica` e a lista de destinos contra os links do conteúdo. Sem banco.
- `node tools/seed-medicao.js`: ~180 contas fictícias com acessos, entradas, falhas, respostas, saídas e pedidos, para ver a aba com dados. Só com `DATABASE_HOST` local; muda o `contar_desde` do banco local. `--limpar` apaga.
