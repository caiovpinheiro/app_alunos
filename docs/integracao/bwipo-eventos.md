# Integração Portal do Aluno ↔ CRM (Bwipo)

O que o portal já faz e o que precisa existir no Bwipo para o chat abrir com o contexto do aluno.
Escrito em 28/10/2026. Arquivos do portal: `public/js/rastreio.js`, `public/js/dificuldade.js`,
`server/webchat.js`, `server/ajuda-pedidos.js`.

## Hoje

Atualizado em 02/11/2026. O widget v2 do Bwipo já aceita `identify`, `setContext`, `track` e `open({ message, ref })`.

- O portal carrega o `embed.js` só para as contas de `WEBCHAT_LIBERADO_PARA`, identifica o aluno com o RGM assinado e envia o contexto ao vivo (tela, módulo, parte, último sinal).
- O pedido de ajuda abre o chat com a mensagem pronta. Se o chat não estiver disponível, segue para o WhatsApp do polo.
- Todo pedido fica gravado no portal (`csu_pedidos_ajuda`), aparece no admin e, com `PEDIDO_AJUDA_WEBHOOK_URL` e `PEDIDO_AJUDA_WEBHOOK_SECRET`, vai ao CRM pelo servidor. O CRM devolve o link da conversa e, se houver, o do negócio; os dois aparecem no admin.
- Para o aluno cair no contato e no negócio que já existem, o canal precisa usar o vínculo por campo de negócio (PRs `backend_crm1#236` e `frontend_crm1#242`). Antes disso, o CRM não acha o RGM guardado no negócio e cria um contato novo.

## 1. No navegador (widget)

O portal já chama estas funções quando elas existem. Não precisa mudar nada do lado do portal.

### `BwipoWebchat.identify(identidade)`

```js
{
  externalId: "1234567",          // RGM (ou e-mail, se a conta ainda não tem RGM)
  name: "Ana Souza",
  email: "ana@...",
  attributes: { curso: "Pedagogia", polo: "Barra Funda" },
  userHash: "<hex>"               // HMAC-SHA256(WEBCHAT_IDENTITY_SECRET, externalId)
}
```

O Bwipo deve conferir o `userHash` com o `identitySecret` do canal. Sem a conferência, qualquer pessoa no console poderia se passar por outro RGM.

### `BwipoWebchat.track(nome, dados, { important, at })`

São eventos de uso, como `trilha_travei`, `central_busca_sem_resultado`, `certificado_erro` e `pedido_ajuda`:
- com `important: true`, o evento vira nota interna na conversa;
- os demais vão para o painel "Atividade no portal".

### `BwipoWebchat.open({ message, ref })` com `BwipoWebchat.capabilities.prefill = true`

Abre o chat com o texto **pré-preenchido e editável** pelo aluno (`message`). O `ref` é o protocolo do pedido (ex.: `AJ-7K2Q`).

O portal só usa esse caminho quando `capabilities.prefill` for `true`; enquanto isso, segue no WhatsApp.

Exemplo de `message`: `Oi! Travei no Módulo 1 (Primeiro acesso), parte 2 "Criar a senha" da Aula Inaugural. Protocolo AJ-7K2Q.`

### Evento `ready` (desejável)

Avisar quando o widget terminou de carregar (por exemplo, `window.dispatchEvent(new Event('bwipo:ready'))`). Hoje o portal confere a cada 2 s por até 2 min.

## 2. No servidor: o pedido de ajuda (portal → CRM)

Contrato do CRM: `docs/decisoes/webchat-widget.md`, §9.6, no `backend_crm1`. Se o envio falhar, o portal tenta de novo a cada 10 min, até 5 vezes em 48 h, sempre com o mesmo corpo.

```
POST {PEDIDO_AJUDA_WEBHOOK_URL}               .../api/public/webchat/s2s/{chave pública do canal}
Content-Type: application/json
X-Timestamp: 1793210000                       (segundos)
X-Signature: sha256=<hex>                     HMAC-SHA256(PEDIDO_AJUDA_WEBHOOK_SECRET, X-Timestamp + "." + corpo)
Idempotency-Key: AJ-7K2Q                      (o protocolo; o mesmo pedido não pode duplicar)
```

`PEDIDO_AJUDA_WEBHOOK_SECRET` é a chave S2S do canal, diferente da chave de identidade (`WEBCHAT_IDENTITY_SECRET`).

```json
{
  "external_id": "25012345",
  "ref": "AJ-7K2Q",
  "category": "travei",
  "priority": "high",
  "text": "Pedido de ajuda AJ-7K2Q · 28/10 14:32 · Ana Souza · RGM 2501234-5 ...",
  "fields": { "protocolo": "AJ-7K2Q", "ultimo_sinal": "...", "curso": "Pedagogia", "polo": "Barra Funda", "modulo": "3 · Estudando no AVA", "parte": "2 · Atividades" },
  "links": [{ "label": "Percurso do aluno", "url": "https://app.cruzeiroead.com.br/admin#acompanhamento/aluno/482" }]
}
```

- `external_id`: só os dígitos do RGM, igual ao `identify`. Conta sem RGM não vai ao CRM.
- `category`: a origem do pedido (`travei`, `certificado_erro`, `quiz_erros`, `busca_vazia`...).
- `priority`: `high` para `travei`, `certificado_erro` e `quiz_erros`; `normal` para as demais. As regras do canal decidem o que isso faz.

A resposta 200 traz `{ conversation_id, url, deal_id?, deal_url? }`. O portal guarda `url` e `deal_url` (só https) em `csu_pedidos_ajuda`, e o admin mostra "Abrir conversa no CRM" e "Abrir negócio no CRM".

## 3. Retorno de situação (CRM → portal), a fazer

Quando o atendente atender ou resolver, o CRM chama o portal com a mesma assinatura. Assim, o admin atualiza o pedido e o portal para de oferecer ajuda ao aluno.

```
POST /api/integracao/pedidos/{protocolo}/situacao   { "situacao": "em_atendimento" | "resolvido" }
```

O CRM já oferece esse retorno (`config.v2.s2s.callbackUrl`, com `{ ref, status: "attended" | "resolved", conversation_id }`), mas a rota ainda não existe no portal. Quando existir, ela deve seguir esse formato em vez do acima.

## Privacidade

- O rastreio é ligado ao RGM, então precisa estar na política de privacidade antes de `RASTREIO_LIBERADO_PARA=*`.
- A oferta de ajuda avisa o aluno: "A equipe do seu polo vai ver em que parte do portal você está".
