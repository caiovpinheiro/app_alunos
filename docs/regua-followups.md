# Régua de acesso com lembretes e testes A/B

Objetivo: levar o primeiro acesso de 54% para 80% das contas (e de 44% para 60% em até 24 h), avisando só
quem ainda não entrou e medindo qual texto funciona melhor. Proposta de 06/11/2026; nada foi ligado no CRM.

## Como funciona

1. **O app avisa o CRM quando a pessoa entra.** Ao entrar (link, login ou cadastro), o app marca a tag
   `app_entrou` no negócio (`POST /api/deals/:id/tags`, Bearer `CRM_API_TOKEN`). O id do negócio chega ao app
   junto do pedido de link (campo `negocio`, mandado pelo n8n na venda e pela própria régua nos lembretes).
2. **Antes de cada lembrete, a régua confere.** O passo webhook chama `POST /api/integracoes/regua-fup`. Se a
   pessoa já entrou, o app marca a tag na hora; a condição seguinte vê a tag e encerra a régua.
3. **Cada lembrete tem um link próprio.** Com `origem`, o mesmo webhook gera um link novo (vale 7 dias, uma vez)
   e grava nos campos do negócio antes do template ser enviado. O link anterior continua valendo; quando um é
   usado, os outros são cancelados.
4. **O vigia mede.** Cada link leva o código da mensagem no `?o=` (`fup1_a`, `fup1_b`...). A aba Vigia mostra,
   por código, quem recebeu e quantos entraram em 24 h, e avisa no WhatsApp da equipe quando uma variante vence.

## Sequência

| Quando | Para quem | Mensagem | Teste |
|---|---|---|---|
| Venda (já existe) | todos | BV com o link pessoal (`bv_acesso`) | |
| +3 h, só entre 8h e 21h | sem `app_entrou` | Lembrete 1 | A: direto e curto · B: o que tem no app |
| +24 h | sem `app_entrou` | Lembrete 2 | A: oferece ajuda · B: "leva menos de 1 minuto" |
| +72 h | sem `app_entrou` | Lembrete 3 + tarefa para o Acolhimento ligar | sem teste |
| a qualquer momento | entrou | a régua para (condição da tag) | |

Um teste por lembrete de cada vez. Não mude o texto nem o rodízio no meio de um teste: comece outro com outro
código (`fup1_c`, ou `fup1h_a` para testar horário). O vigia declara o vencedor quando cada variante tem 60
contas e a diferença passa da margem (z ≥ 1,96; 2,24 com 3 variantes). Antes disso, mostra "Coletando" ou
"Sem diferença ainda".

## Templates (WhatsApp, categoria UTILITY, pt_BR)

Todos com o corpo abaixo, `{{1}}` = primeiro nome, e o botão de URL **Entrar no app** com URL dinâmica
`https://app.cruzeiroead.com.br/a/{{1}}` (no CRM, a variável do botão é o campo `link_acesso_codigo`).
Mensagem de acesso a uma conta que a pessoa já tem é utilidade; evitar palavras de promoção para a Meta não
recategorizar como MARKETING (o vigia alerta se isso acontecer, via `VIGIA_TEMPLATES_CHAVE`).

**`acesso_lembrete1_a`** (Lembrete 1, variante A)
> Olá, {{1}}! Seu acesso ao App do Aluno já está liberado. Toque em *Entrar no app* para abrir a sua área sem
> digitar RGM nem senha. O link é pessoal e vale por 7 dias.

**`acesso_lembrete1_b`** (Lembrete 1, variante B)
> Olá, {{1}}! Sua matrícula já tem acesso ao App do Aluno. Lá estão a Aula Inaugural, o passo a passo do AVA
> e o seu certificado de 4 horas. Toque em *Entrar no app* para entrar sem senha. O link é pessoal e vale por
> 7 dias.

**`acesso_lembrete2_a`** (Lembrete 2, variante A) · botões: *Entrar no app* (URL) e *Preciso de ajuda* (resposta rápida)
> {{1}}, o seu acesso ao App do Aluno ainda não foi usado. Se algo não funcionou, toque em *Preciso de ajuda*
> e a equipe do polo responde por aqui. Para entrar agora, toque em *Entrar no app*.

**`acesso_lembrete2_b`** (Lembrete 2, variante B) · mesmos botões
> {{1}}, entrar no App do Aluno leva menos de 1 minuto: toque em *Entrar no app* e você já cai na sua área,
> sem senha. É por lá que você começa o curso e recebe os avisos do polo.

**`acesso_lembrete3`** (Lembrete 3) · botões: *Entrar no app* (URL) e *Falar com o polo* (resposta rápida)
> {{1}}, renovamos o seu link de acesso ao App do Aluno. Toque em *Entrar no app* para abrir a sua área. Se
> preferir, toque em *Falar com o polo* e alguém da equipe chama você.

## Passos na automação do CRM

Uma automação nova, "Lembretes de acesso", com o mesmo gatilho da BV (negócio criado na etapa Acolhimento do
funil ACADÊMICO). Corpo de todos os webhooks: `POST https://app.cruzeiroead.com.br/api/integracoes/regua-fup`,
JSON com `"segredo"` (o mesmo de `LINK_ACESSO_SEGREDO`), `"negocio": "{{deal.id}}"` e `"rgm": "{{campo RGM do negócio}}"`.

```
1  delay 3 h
2  business_hours 8h–21h (fora disso, espera abrir)
3  webhook {segredo, negocio, rgm}                          ← confere e marca app_entrou
4  condition: negócio tem tag app_entrou → finish
5  round_robin  A | B
6A webhook {…, "origem": "fup1_a"} → template acesso_lembrete1_a
6B webhook {…, "origem": "fup1_b"} → template acesso_lembrete1_b
7  delay até completar 24 h desde a venda
8  webhook {segredo, negocio, rgm}  → condition tag app_entrou → finish
9  round_robin  A | B
10A webhook {…, "origem": "fup2_a"} → template acesso_lembrete2_a
10B webhook {…, "origem": "fup2_b"} → template acesso_lembrete2_b
11 delay até 72 h
12 webhook {segredo, negocio, rgm}  → condition tag app_entrou → finish
13 webhook {…, "origem": "fup3"} → template acesso_lembrete3
14 create_activity para o responsável do Acolhimento: "Não entrou no app em 3 dias: ligar"
```

O webhook só devolve erro com segredo errado: conta não encontrada, CRM fora ou banco fora respondem 200, para
não interromper a régua (no CRM, webhook com erro para o fluxo daquele aluno).

## O que configurar

| Onde | O quê |
|---|---|
| CRM | campo de negócio `link_acesso_codigo` (texto) e a tag `app_entrou`; os 5 templates; a automação acima |
| n8n | no nó que chama `/api/integracoes/link-acesso` na venda, mandar também `"negocio": <id do negócio criado>` |
| EasyPanel | `CRM_API_TOKEN`, `CRM_CAMPO_LINK_ACESSO` (id do campo `link_acesso`), `CRM_CAMPO_LINK_CODIGO`, e `VIGIA_TEMPLATES_CHAVE` com os 5 nomes |

Sem `negocio` no pedido da venda, a tag só é marcada quando um lembrete confere (passo 3), e o lembrete 1
ainda sai para quem entrou nas primeiras 3 h sem a tag. Por isso o item do n8n vem primeiro.

## Onde ver o resultado

Admin › Vigia › "Régua: o que funciona": por código, receberam, entraram em 24 h e a taxa; e o estado de cada
teste. Quando um teste tem vencedor, a mensagem de 2 em 2 horas para a equipe traz "🟢 Teste fup1: a variante B
venceu" com a ação (deixar só a vencedora no rodízio).
