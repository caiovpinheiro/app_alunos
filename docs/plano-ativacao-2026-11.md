# Diagnóstico e plano: mais acessos e mais sucesso no App do Aluno

Data: 06/11/2026. Fontes: admin do app (Visão geral, Ao vivo, Aula Inaugural, Quem contatar), CRM de produção (`cruzeiro-ead.bwipo.com`: automações e estatísticas), código do app na `main` (13920a8) e do CRM na `DEV_BRANCH`. Só leitura: nada foi alterado.

## 1. Resumo

1. **O gargalo não é o conteúdo, é a porta de entrada.** Nos últimos 30 dias, 366 contas foram criadas e 170 (46%) nunca entraram. Quem entra e começa a Aula vai até o fim: dos módulos 2 ao 7 quase ninguém para. A perda está em três lugares: não entrar (46%), entrar e não começar (89 alunos) e parar no módulo 1 (17 dos 54 que o abriram desde 04/11).
2. **A régua do CRM manda o acesso, mas não sabe quem entrou.** A automação "BV - Calouros" entrega login e senha e tem boa resposta (90 de 101 clicam em "Quero meu acesso"), mas não há lembrete baseado em "não entrou no app", porque o app não devolve nada ao CRM. O webhook que ligaria a régua ao painel está **desligado**, com o segredo ainda como `COLE_O_SEGREDO_AQUI`.
3. **O template antigo está sendo bloqueado pela Meta** como mensagem de marketing (111 falhas contra 1 clique nas rotas recentes), e o template novo `bv_app2` não está aprovado em pelo menos um canal.
4. **O certificado trava 1 em cada 3 alunos que terminam.** Só 43% dos que concluem emitem (meta: 90%). A causa é o curso e o polo chegarem só com o relatório de matriculados do dia seguinte, e o app devolver um erro sem código e, na tela da Aula, provavelmente invisível.
5. **O app mede muito e decide pouco.** Há eventos de vídeo, busca, travei e progresso, mas falta o que diz o que produzir: "deu certo?", saída para o AVA, retenção D+1/D+7 por coorte e canal de origem do acesso.

## 2. Números de hoje

### Funil dos últimos 30 dias (08/10 a 06/11, contas criadas no período)

| Etapa | Alunos | Conversão | Faixa | Meta |
|---|---:|---:|---|---|
| Contas criadas | 366 | | | |
| Entraram no portal | 196 | 54% das contas | ruim | 80% |
| Primeiro acesso em até 24 h | 126 de 287 | 44% | regular | 60% |
| Começaram a Aula | 107 | 55% de quem entrou | regular | 70% |
| Concluíram a Aula | 63 | 59% de quem começou | bom | 50% |
| Emitiram o certificado | 27 | 43% de quem concluiu | ruim | 90% |

Pendências do painel: 170 nunca entraram, 82 entraram e não começaram, 36 concluíram sem certificado, 34 com erro no certificado, 9 sumiram, 6 pararam.

### Contas novas desde 04/11 (aba Ao vivo, 147 contas)

| Etapa | n | % |
|---|---:|---:|
| Entraram | 89 | 61% |
| Em até 24 h | 36 de 68 | 53% |
| Começaram a Aula | 56 | 38% |
| Concluíram | 32 | 22% |
| Certificado | 10 | 7% |

Por que faltam 137: 33 ainda no prazo de 24 h; 25 nunca entraram; 33 entraram e não começaram; 24 começaram e não concluíram; 21 concluíram e tiveram erro no certificado; 1 não tentou.

### Onde a Aula perde gente

| Módulo | Abriram | Concluíram | Parados |
|---|---:|---:|---:|
| 1 Primeiro acesso | 54 | 37 | **17** |
| 2 Área do Aluno | 40 | 36 | 4 |
| 3 AVA | 37 | 35 | 1 |
| 4 Provas e notas | 36 | 35 | 1 |
| 5 Dinheiro | 35 | 34 | 1 |
| 6 Horas | 34 | 34 | 0 |
| 7 Formatura | 34 | 34 | 0 |

No módulo 1 (30 dias, 130 alunos rastreados): 26 abandonaram ali, 74 vídeos abandonados em 253 iniciados, 611 pausas, parada mediana aos 40% do vídeo, 4 min de tempo mediano. No módulo 4, a pergunta da recuperação (AF) tem 85 erros e só 8 de 68 concluem sem errar. Uso geral: 571 acessos, 196 alunos ativos, 17 min por acesso, 70% dos vídeos chegam ao fim, 98% de 👍.

### Régua do CRM (automação "BV - Calouros")

- Gatilho: negócio criado na etapa Acolhimento do funil ACADÊMICO. 56 passos. Volume de matrículas nessa etapa: 301, 390, 254 e 217 por semana desde 12/10 (45 a 80 por dia).
- Caminho atual: se o negócio tem `senha_painel_eduit`, manda o template `bv_app2` ("Quero meu acesso"); se não, espera 1 h e 4 h; se ainda não houver senha, cai no template antigo `bemvindo_calouro` com o menu de dúvidas.
- Últimos 7 dias: 644 disparos, 220 envios de `bv_app2`, 181 envios de credenciais. Nos desfechos registrados do template: 75 "Quero meu acesso", 15 "Primeiro acesso", 2 "Sobre o curso", 7 sem resposta em 24 h. Ou seja, quem recebe responde.
- Problemas: `bemvindo_calouro` com 114 falhas em 1.307 envios em 30 dias e, nas rotas, 111 falhas contra 1 clique, com o erro "Meta limitou esta mensagem de marketing"; `bv_app2` "não aprovado na WABA" de um canal; os três webhooks do fluxo vão para o n8n, não para o app; a automação "Painel - régua calouros (webhook)" está inativa e sem segredo; não existe passo que avise `login` ou `sem_resposta` ao app; senha enviada em texto no WhatsApp; sem opt-out.
- Campanha manual "Reenvio acesso portal - 04/11": 51 envios, cerca de 10 respostas.

### Base de matriculados

Relatório de 05/11 às 10:06, aplicado às 13:33. 35.395 em curso, 752 pessoas com mais de um curso, 20 fora da base. Hoje a conta do aluno nasce no sync (já com curso e polo), no cadastro feito pelo próprio aluno (sem curso e polo até o relatório chegar) ou no "acesso em preparação" feito pelo polo (sem RGM e sem polo).

## 3. Diagnóstico por frente

### A. Régua de comunicação e ativação

O que funciona: a régua existe, dispara na matrícula, entrega a senha e tem resposta alta no botão. O que não funciona:

- **Ela é cega.** O CRM não recebe do app "entrou", "começou", "concluiu", "emitiu". Por isso não há lembrete em D+1 para quem não entrou, nem convite para quem entrou e não começou. A infraestrutura dos dois lados existe: condições por campo, tag e `siteEvent` no CRM; `csu_regua_eventos` e a aba Ao vivo no app.
- **A régua do painel nunca foi ligada.** Falta `REGUA_WEBHOOK_SEGREDO` no EasyPanel e colar o mesmo valor na automação inativa. Mesmo ligada, ela só cobre `oferta` e `sem_senha`: `login` e `sem_resposta` não têm passo na BV.
- **Entrega comprometida.** Template de marketing bloqueado pela Meta e `bv_app2` sem aprovação em um canal. Parte dos 46% que "nunca entraram" pode nunca ter recebido a mensagem.
- **A mensagem pede muito.** Login, senha, link, "selecione Ensino Superior", "recupere o e-mail". No celular (71% dos alunos), cada passo perde gente. A mesma régua resolve isso com um link que já entra logado.
- **Sem medida de ponta a ponta.** O CRM mede clique no botão; o app mede login. Ninguém mede "recebeu a mensagem e entrou em 24 h", porque o link não carrega a origem.

### B. Certificado em D+1

Causa exata: o app só conhece curso e polo de quem está em uma linha "EM CURSO" do **último relatório de matriculados**, que é importado uma vez por dia fora do app. O intervalo do sync (30 min) não é o gargalo: a rota do certificado consulta o relatório na hora. Quem conclui a Aula no dia do cadastro recebe um 422 sem código ("tente de novo amanhã"), nada é gravado, ninguém é avisado, e o aluno precisa lembrar de voltar.

Agravantes encontrados no código:
- Na tela da Aula, a caixa de erro usa o atributo `hidden`, e o JS só remove a classe: o erro provavelmente nem aparece.
- O card do Início continua dizendo "Certificado liberado!", porque só olha módulos e pontos.
- O **curso não é impresso no PDF**; só o polo. O bloqueio por curso existe porque a coluna é NOT NULL e porque avisos e atendimento leem o curso do certificado.
- Avisos segmentados e o WhatsApp do polo leem curso e polo do **último certificado**, não de `csu_alunos`: sem certificado, o aluno fica no contato geral.
- `upsertAcessoDerived` sobrescreve curso e polo com NULL em alguns caminhos (`/api/admin/sync-acessos`), e o RGM do cadastro pode ser gravado com hífen, enquanto o sync compara só dígitos.
- Cada download cria um certificado novo (sem idempotência), e a data impressa é a da emissão, não a da conclusão.

Fontes de curso e polo disponíveis antes do D+1: o próprio aluno (formulário de certificado antigo já tem autocomplete de curso e lista de 12 polos), a planilha do polo (`csu_dados_acesso`, que tem curso mas não polo e não é lida pelo certificado), e o CRM (campos `curso` e `polo` do negócio, preenchidos na matrícula).

### C. Aderência e rastreio

Medido hoje e disponível no admin: login, sessões com tempo ativo e dispositivo, telas, cliques, vídeo em quartis e pausas, progresso por módulo, respostas, travei, joinha, busca sem resultado, certificado, pedidos de ajuda, cliques no WhatsApp. O rastreio fino está ligado para todos (`RASTREIO_LIBERADO_PARA=*`).

O que falta, por valor de decisão:
1. **"Deu certo / Não funcionou"** no fim de cada módulo e tutorial. O componente de joinha já aceita pergunta própria.
2. **Saída para o sistema da universidade** (AVA, Área do Aluno, e-mail acadêmico, lojas do Duda e Authenticator). Hoje é só um `clique` com `externo:true`, sem agregação. É o resultado real do onboarding.
3. **Retenção D+1, D+7 e por coorte semanal.** Os dados estão em `csu_acessos`, falta o relatório. `csu_sessoes` é apagada no logout, então o histórico de login completo depende do rastreio.
4. **Canal de origem do acesso** (`?o=bv` no link da régua) e **falha de login / esqueci a senha**, que hoje não são medidos porque o rastreio só liga depois do login.
5. **Conversão das ofertas de ajuda** (oferecida, aceita, resolvida, tempo) e do "Fazer agora / depois" do módulo 1.
6. Preferências de acessibilidade como evento, "Começar de novo" registrado antes de apagar, vídeos do YouTube em iframe (invisíveis).

### D. Conteúdo e formato

- O módulo 1 concentra o atrito: é o único com abandono relevante, tem 611 pausas e para aos 40% do vídeo. Ele pede ao aluno que saia do app, recupere e-mail, crie senha e configure o Authenticator. Vídeo único e longo para quatro tarefas no celular.
- A pergunta da AF no módulo 4 tem 85 erros: é um problema de enunciado, não de aprendizado.
- Os vídeos antigos de passo a passo não têm duração cadastrada, então não entram nos relatórios de abandono. `videos.json` já tem `duracao`, `serie` e `parte`: a estrutura de "shorts" existe.
- Busca sem resultado é rara (1 termo em 30 dias). A Central não é onde o aluno se perde.

## 4. Plano em ondas

### Onda 0: esta semana (configuração e correções pequenas)

| # | Ação | Dono | Esforço | Efeito esperado |
|---|---|---|---|---|
| 0.1 | Definir `REGUA_WEBHOOK_SEGREDO` no EasyPanel, colar na automação "Painel - régua calouros (webhook)" e ativá-la | Você (EasyPanel + CRM) | 30 min | Ao vivo passa a explicar quem nunca entrou |
| 0.2 | Adicionar na BV os passos `webhook` de `login` (após enviar credenciais) e `sem_resposta` (após o timeout do template) | CRM (config) | 1 h | Régua completa no painel |
| 0.3 | Pedir aprovação de `bv_app2` em todos os canais e recategorizar `bemvindo_calouro` como utilidade (ou aposentá-lo) | CRM / Meta | 1 dia de fila da Meta | Para de perder a primeira mensagem |
| 0.4 | Campanha manual para os 36 que concluíram sem certificado e os 34 com erro: "seu certificado está liberado" (o dado já chegou) | Atendimento | 1 h | Até 70 certificados |
| 0.5 | Corrigir os bugs do certificado: erro invisível na Aula, 422 com `codigo`, card do Início com estado "esperando curso/polo", `COALESCE` no `upsertAcessoDerived`, RGM só dígitos no cadastro | Produto (sessão Opus) | 1 dia | Aluno entende o que falta |
| 0.6 | Colocar `?o=bv` (e `o=reenvio`, `o=polo`) nos links enviados pelo CRM e gravar a origem no login | Produto + CRM | meio dia | Primeira medida de ponta a ponta |

### Onda 1: próximas 2 a 3 semanas

| # | Ação | Dono | Esforço | Efeito esperado |
|---|---|---|---|---|
| 1.1 | **Certificado no mesmo dia:** emitir sem polo e completar depois (`csu_certificados` aceita NULL, o sync preenche, o PDF omite a linha do polo até existir); data de conclusão em vez de emissão; um certificado por aluno; avisos e atendimento lendo `csu_alunos`; `csu_dados_acesso` ganha polo e passa a ser lida pelo certificado | Produto | 3 a 4 dias | Certificado de 43% para perto de 90% de quem conclui |
| 1.2 | **Loop app → CRM:** o app aplica tags no negócio (`app_entrou`, `app_modulo1`, `app_aula_ok`, `app_certificado`) pela API do CRM, chaveado pelo RGM. Tag dispara automação | Produto (cliente de API no app) + CRM (config) | 3 dias | Régua passa a enxergar o aluno |
| 1.3 | **Régua fechada em loop** (só configuração, depois do 1.2): D+1 sem `app_entrou` → lembrete com link; D+3 → humano do Acolhimento; com `app_entrou` e sem `app_modulo1` em 48 h → "falta começar a Aula"; `app_aula_ok` sem `app_certificado` em 24 h → "seu certificado está pronto" | CRM | 1 dia | Lembretes no momento certo, sem fila manual |
| 1.4 | **Instrumentação:** "Deu certo / Não funcionou" em módulo e tutorial; evento `saida_externa` por destino; falha de login e "esqueci a senha" no servidor; eventos de acessibilidade; relatório de retenção D+1/D+7 por coorte e de conversão das ofertas de ajuda no admin | Produto | 4 dias | Base para decidir conteúdo |
| 1.5 | **Módulo 1 em duas partes** (acesso: e-mail e senha; segurança: Authenticator e Duda), com um vídeo curto por tarefa (30 a 60 s), checklist "Fazer agora" que abre o link certo e registra a saída, e "Deu certo?" ao voltar | Conteúdo + Produto | 1 semana | Menos 17 parados em 54 |
| 1.6 | Reescrever a pergunta da AF do módulo 4 e revisar as duas perguntas mais erradas de cada módulo | Conteúdo | 2 h | Menos atrito sem perda de aprendizado |

### Onda 2: 4 a 8 semanas

| # | Ação | Dono | Esforço | Efeito esperado |
|---|---|---|---|---|
| 2.1 | **Entrar por link, sem senha:** o CRM envia um link assinado e com validade; o app cria a sessão e pede para definir a senha depois. Tira a senha em texto do WhatsApp | Produto (revisão de segurança) + CRM | 1 semana | Maior alavanca para os 46% que não entram |
| 2.2 | **Shorts na Central:** séries por tarefa a partir dos passos a passo existentes, com duração cadastrada, "Não funcionou" abrindo o chat com contexto e FAQ alimentada pelas buscas e pelos "não funcionou" | Conteúdo + Produto | 2 semanas | Resolução sem atendimento |
| 2.3 | **Testes A/B na régua** (infra já existe em `ao-vivo-testes`): texto, horário de envio, com e sem vídeo, link direto e link com senha | Produto + CRM | 2 dias para ligar | Decisões por dado |
| 2.4 | **Melhorias no CRM** (PRs em DEV): opt-out nativo, métricas de entregue/lido/respondido por régua, gatilho por campo alterado, webhook de saída com retentativa | CRM (sessões Opus) | 2 a 3 semanas | Régua auditável e segura |
| 2.5 | Curso e polo também pelo CRM na matrícula (endpoint `/api/integracoes/matricula`), como segunda fonte antes do relatório | Produto + CRM | 3 dias | Grupo de estudo, avisos e atendimento certos desde o dia 0 |

## 5. Metas e medição

| Indicador | Hoje | Meta em 60 dias | Onde ver |
|---|---:|---:|---|
| Entraram no portal | 54% | 80% | Visão geral |
| Primeiro acesso em até 24 h | 44% | 60% | Visão geral e Ao vivo |
| Começaram a Aula (de quem entrou) | 55% | 70% | Visão geral |
| Parados no módulo 1 (de quem abriu) | 31% | 10% | Ao vivo |
| Certificado (de quem concluiu) | 43% | 90% | Visão geral |
| Retenção D+7 | não medido | medir na Onda 1 e fixar meta | novo relatório |
| Entrega da primeira mensagem | não medido | 95% | CRM (stats por passo) |

Regra de leitura: comparar coortes por semana de criação da conta, nunca o total acumulado, porque cada onda muda o funil só para quem chega depois dela.

## 6. Riscos e decisões que não são de produto

- **Senha em texto no WhatsApp** (`{{dealCustomFields.senha_painel_eduit}}`): risco de LGPD e de segurança. O link assinado (2.1) resolve; até lá, considerar enviar só o link de "criar senha".
- **Categoria dos templates na Meta:** mensagem de acesso é utilidade, não marketing. A recategorização depende da Meta e pode exigir reescrever o texto.
- **Opt-out:** o CRM não tem. Modelar com tag até a Onda 2.4.
- **Rastreio ligado para todos:** a política de privacidade precisa citar o acompanhamento e o envio de contexto ao CRM.
- **Certificado sem polo:** o acadêmico precisa aceitar um PDF sem a linha do polo até o relatório chegar (1.1). Alternativa: pedir o polo ao aluno no cadastro, com lista fechada.
- **Dados do relatório:** 752 pessoas com mais de um curso e 20 fora da base. O sync escolhe por e-mail; vale uma regra explícita para quem tem dois cursos.

## 7. Como executar

Frentes independentes, cada uma em uma sessão própria com Opus, partindo da `main` e sem publicar sem aprovação:

1. **Certificado no mesmo dia** (0.5 + 1.1): app.
2. **Instrumentação e "Deu certo"** (0.6 + 1.4): app.
3. **Loop app → CRM e régua fechada** (1.2 + 1.3 + 0.2): app, mais configuração no CRM com você.
4. **Módulo 1 e shorts** (1.5 + 1.6 + 2.2): conteúdo e app; precisa das artes e dos vídeos curtos.
5. **Entrar por link** (2.1): app, com revisão de segurança antes de ligar.
6. **CRM** (2.4): PRs em `DEV_BRANCH`, como foi feito com o vínculo por campo de negócio.

As frentes 1 e 2 podem começar hoje. A 3 depende de um token de API do CRM e de decidir onde ficam as tags. A 0.1, 0.3 e 0.4 são suas, no EasyPanel, no CRM e com o atendimento.
