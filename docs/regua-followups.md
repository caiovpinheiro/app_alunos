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

## Sequência

O rodízio sorteia uma vez, no começo; cada pessoa recebe sempre a mesma variante nos três lembretes.

| Quando | Para quem | Variante A | Variante B |
|---|---|---|---|
| Venda (já existe) | todos | BV com o link pessoal (`bv_acesso`) | igual |
| +3 h, só entre 8h e 21h | sem `app_entrou` | `bv_app2`, código `fup1_a` | `bv_app1`, código `fup1_b` |
| +24 h | sem `app_entrou` | `bv_app2`, código `fup2_a` | `bv_app1`, código `fup2_b` |
| +72 h | sem `app_entrou` | `bv_app2`, código `fup3_a` + tarefa para o Acolhimento ligar | `bv_app1`, código `fup3_b` + tarefa |
| a qualquer momento | entrou | a régua para (condição da tag) | igual |

O vigia compara `fup1_a` com `fup1_b`, `fup2_a` com `fup2_b` e assim por diante. Declara o vencedor quando cada
variante tem 60 contas e a diferença passa da margem (z ≥ 1,96). Antes disso mostra "Coletando" ou "Sem
diferença ainda". Não mude o rodízio no meio do teste: para testar outra coisa, use outros códigos.

## Mensagem depois do toque em "Quero meu acesso"

Mensagem comum (não é template; vale dentro da janela de 24 h aberta pelo toque):

> Aqui está o seu link de entrada no App do Aluno:
> {{link_acesso}}
> Ele abre a sua área sem pedir senha, vale por 7 dias e funciona uma vez. Se não abrir, responda esta mensagem.

`{{link_acesso}}` é o campo do negócio que o webhook do lembrete acabou de gravar.

## Passos na automação do CRM

Uma automação nova, "Lembretes de acesso", com o mesmo gatilho da BV (negócio criado na etapa Acolhimento do
funil ACADÊMICO). Todos os webhooks: `POST https://app.cruzeiroead.com.br/api/integracoes/regua-fup`, JSON
com `"segredo"` (o mesmo de `LINK_ACESSO_SEGREDO`), `"negocio": "{{deal.id}}"` e `"rgm": "{{campo RGM do negócio}}"`.

```
1  delay 3 h
2  business_hours 8h–21h (fora disso, espera abrir)
3  webhook {segredo, negocio, rgm}                   ← confere e marca app_entrou se já entrou
4  condition: negócio tem tag app_entrou → finish
5  round_robin  A | B

Caminho A (repita em B trocando bv_app2 → bv_app1 e _a → _b):
6  webhook {…, "origem": "fup1_a"}                   ← gera o link e grava em link_acesso
7  template bv_app2
8  wait_for_reply (até 24 h): resposta "Quero meu acesso" → mensagem do link (seção acima)
9  delay até completar 24 h desde a venda
10 webhook {segredo, negocio, rgm} → condition tag app_entrou → finish
11 webhook {…, "origem": "fup2_a"} → template bv_app2 → wait_for_reply → mensagem do link
12 delay até 72 h
13 webhook {segredo, negocio, rgm} → condition tag app_entrou → finish
14 webhook {…, "origem": "fup3_a"} → template bv_app2 → wait_for_reply → mensagem do link
15 create_activity para o responsável do Acolhimento: "Não entrou no app em 3 dias: ligar"
```

Antes de ligar, confira no CRM que o toque em "Quero meu acesso" de um lembrete não é tratado também pela BV
(as duas usam o mesmo botão), para a pessoa não receber o link e as credenciais ao mesmo tempo.

O webhook só devolve erro com segredo errado: conta não encontrada, CRM fora ou banco fora respondem 200, para
não interromper a régua (no CRM, webhook com erro para o fluxo daquele aluno).

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
