# Régua de acesso com lembretes e testes A/B

Objetivo: levar o primeiro acesso de 54% para 80% das contas (e de 44% para 60% em até 24 h), avisando só
quem ainda não entrou e medindo qual mensagem funciona melhor. Desenho de 06/11/2026; nada foi ligado no CRM.

## Como funciona

1. **O app avisa o CRM quando a pessoa entra.** Ao entrar (link, login ou cadastro), o app marca a tag
   `app_entrou` no negócio (`POST /api/deals/:id/tags`, Bearer `CRM_API_TOKEN`). O id do negócio chega ao app
   junto do pedido de link (campo `negocio`, mandado pelo n8n na venda e pela própria régua nos lembretes).
2. **Antes de cada lembrete, a régua confere.** O passo webhook chama `POST /api/integracoes/regua-fup`. Se a
   pessoa já entrou, o app marca a tag na hora; a condição seguinte vê a tag e encerra a régua.
3. **Cada lembrete tem um link próprio.** Com `origem`, o mesmo webhook gera um link novo (vale 7 dias, uma vez)
   e grava no campo `link_acesso` do negócio. O link anterior continua valendo; quando um é usado, os outros são
   cancelados.
4. **O link vai depois do toque.** O template não leva link (é o que a Meta aceita como utilidade). Quem toca em
   "Quero meu acesso" abre a janela de 24 h do WhatsApp, e a régua responde com o link numa mensagem comum.
5. **O vigia mede.** O link de cada lembrete leva o código no `?o=` (`fup1_a`, `fup1_b`...). O link é gerado na
   hora do envio do template, então a base é "quem recebeu o lembrete", e a taxa é "entrou em até 24 h por
   qualquer caminho" (pelo link, com senha ou depois de tocar no botão).

## Por que não há templates novos

Em 06/11 o template `acesso_lembrete1_a` (texto com botão de link e tom de lembrete) foi recusado na hora pela
Meta como `INCORRECT_CATEGORY`, como já tinha acontecido com `bv_app`. Os que passam como UTILITY seguem o
padrão de `bv_app1` e `bv_app2`: avisam a situação da conta ("o seu primeiro acesso ainda não foi registrado"),
sem link no texto, com botão de resposta rápida "Quero meu acesso". Os dois já estão aprovados e já dizem o que
o lembrete precisa dizer, então viram as variantes do teste:

| Variante | Template | Diferença |
|---|---|---|
| A | `bv_app2` | sem o nome da pessoa (é o mesmo texto da BV) |
| B | `bv_app1` | começa com "Olá, {{1}}!" (primeiro nome) |

Testes de texto novos ficam para depois, sempre nesse padrão (aviso da conta + resposta rápida). O
`acesso_lembrete1_a` recusado continua no CRM com status REJECTED; não atrapalha nada.

## Sequência (como está montada)

| Quando | Para quem | Variante A | Variante B |
|---|---|---|---|
| Venda | todos | BV: `bv_app2` com o link pessoal no "Quero meu acesso" (`bv_acesso`) | igual |
| +24 h sem resposta | sem `app_entrou` | lembrete `bv_app2`, link `fup1_a` | lembrete `bv_app1` (com o nome), link `fup1_b` |
| +48 h sem resposta | sem `app_entrou` | n8n `acad_sem_interacao` (como antes) | igual |
| a qualquer momento | entrou | a régua encerra na próxima checagem | igual |

O rodízio sorteia uma vez por negócio. O vigia compara `fup1_a` com `fup1_b` e declara o vencedor quando cada
variante tem 60 contas e a diferença passa da margem (z ≥ 1,96). Antes disso mostra "Coletando" ou "Sem
diferença ainda". Não mude o rodízio no meio do teste: para testar outra coisa (horário, um lembrete em +3 h),
use outros códigos.

O toque em "Quero meu acesso" já é tratado pela BV: ela confere `link_acesso` e manda o link pessoal numa
mensagem comum (vale dentro da janela de 24 h aberta pelo toque). Depois do webhook do lembrete, esse campo já
traz o link com o código da variante.

## O que está montado no CRM (06/11/2026)

A "BV - Calouros" já fazia o lembrete: manda `bv_app2`, espera 24 h sem resposta, manda `bv_app2` de novo e,
sem resposta em mais 24 h, chama o n8n `acad_sem_interacao`. O toque em "Quero meu acesso" já manda o link
pessoal (`{{dealCustomFields.link_acesso}}`). Uma automação paralela duplicaria os lembretes, então foi criada
uma **cópia desligada**: **"BV - Calouros (com checagem de acesso)"** (`cmw5mcpv203h1ny01585i08vv`).

- 60 dos 62 passos são idênticos aos da BV (ids com o prefixo `bvc-`). Mesmo gatilho.
- `bv_app2` sem resposta em 24 h → `fup-checa-24h` (webhook) → `fup-recarrega-24h` → `fup-entrou-24h`:
  tem `app_entrou`? encerra : rodízio `fup-rodizio-1`
  - A: webhook `origem: fup1_a` → o lembrete `bv_app2` de sempre
  - B: webhook `origem: fup1_b` → `bv_app1` com `{{contact.name|first_name}}` (mesmos botões)
- Lembrete A ou B sem resposta em 24 h → `fup-checa-48h` → `fup-recarrega-48h` → `fup-entrou-48h`:
  tem `app_entrou`? encerra : n8n `acad_sem_interacao` (como antes).

O passo "remover tag `app_recarregar_tags`" não remove nada (a tag não existe): ele só existe porque o CRM
recarrega as tags do negócio depois de remover tag, e não depois de webhook. Sem ele, a condição veria as tags
de antes da checagem.

Webhooks `fup-*`: `POST https://app.cruzeiroead.com.br/api/integracoes/regua-fup` com
`{"segredo": "COLE_O_SEGREDO_AQUI", "negocio": "{{deal.id}}", "rgm": "{{dealCustomFields.rgm}}"}` (e `origem`
nos dois do rodízio). **O segredo precisa ser colado** (o mesmo de `LINK_ACESSO_SEGREDO`) nos 4 webhooks:
`fup-checa-24h`, `fup-link-1a`, `fup-link-1b`, `fup-checa-48h`. Com o texto de exemplo o app responde 401, e no
CRM webhook com erro para o fluxo daquele aluno.

### Para ligar (nesta ordem)

1. Publicar o app com os PRs #7 e #8 e conferir que `/api/integracoes/regua-fup` responde.
2. Colar o segredo nos 4 webhooks `fup-*` da cópia.
3. No EasyPanel: `VIGIA_CRM_BV=cmw5mcpv203h1ny01585i08vv` e
   `VIGIA_CRM_PASSO_MATRICULA=bvc-b9e9f48a-1656-43a9-b5b1-9196168cbec3` (o vigia passa a ler a cópia).
4. Desligar a "BV - Calouros" e ligar a cópia na mesma hora. Para voltar atrás: o inverso.

Quem já está no meio da BV antiga termina nela; só negócios novos entram na cópia.

## O que configurar

| Onde | O quê |
|---|---|
| CRM | a tag `app_entrou` e a automação acima |
| n8n | no nó que chama `/api/integracoes/link-acesso` na venda, mandar também `"negocio": <id do negócio criado>` |
| EasyPanel | `CRM_API_TOKEN`, `CRM_CAMPO_LINK_ACESSO` (id do campo `link_acesso` do negócio) e `VIGIA_TEMPLATES_CHAVE=bv_app1,bv_app2` (o vigia alerta se saírem de APPROVED ou virarem MARKETING) |

`CRM_CAMPO_LINK_CODIGO` só é preciso num template com botão de URL dinâmica, que hoje não existe.

Sem `negocio` no pedido da venda, a tag só é marcada quando um lembrete confere (passo 3). Por isso o item do
n8n vem primeiro.

## Depois de entrar: o e-mail acadêmico

O primeiro passo na faculdade é descobrir o e-mail acadêmico no atalho
`https://emailacademico.cruzeiroead.com.br/descobrir` (redireciona para o SSO da Cruzeiro do Sul). O app já leva
o aluno até lá no módulo 1 da Aula Inaugural e na Central, e conta cada saída para o site. O vigia mostra quantos
foram ao site a cada 2 h e alerta se o atalho cair ou passar a apontar para fora da Cruzeiro do Sul. O link do
atalho não entra nas mensagens de acesso: um segundo link ali disputa o toque com "Entrar no app".

## Onde ver o resultado

Admin › Vigia › "Régua: o que funciona": por código, receberam, entraram em 24 h e a taxa; e o estado de cada
teste. Quando um teste tem vencedor, a mensagem de 2 em 2 horas para a equipe traz "🟢 Teste fup1: a variante B
venceu" com a ação (deixar só a vencedora no rodízio).
