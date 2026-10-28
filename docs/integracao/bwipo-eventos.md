# Integração Portal do Aluno ↔ CRM (Bwipo)

O que o portal já faz e o que precisa existir no Bwipo para o chat abrir com o contexto do aluno.
Escrito em 28/10/2026. Arquivos do portal: `public/js/rastreio.js`, `public/js/dificuldade.js`,
`server/webchat.js`, `server/ajuda-pedidos.js`.

## Hoje

- O portal carrega o `embed.js` do Bwipo só para as contas de `WEBCHAT_LIBERADO_PARA`.
- O widget só expõe `open()`, `close()` e `toggle()`. Por isso:
  - os eventos do aluno (`track`) ficam numa fila no navegador e se perdem ao fechar a página;
  - o pedido de ajuda abre o **WhatsApp do polo** com a mensagem pronta e o protocolo.
- Todo pedido de ajuda fica gravado no portal (`csu_pedidos_ajuda`) e aparece no admin, em Quem contatar.

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

O portal envia cada pedido quando o Environment tem `PEDIDO_AJUDA_WEBHOOK_URL`. Se o envio falhar, ele tenta de novo a cada 10 min, até 5 vezes em 48 h.

```
POST {PEDIDO_AJUDA_WEBHOOK_URL}
Content-Type: application/json
X-Timestamp: 1793210000                       (segundos)
X-Signature: sha256=<hex>                     HMAC-SHA256(PEDIDO_AJUDA_WEBHOOK_SECRET, X-Timestamp + "." + corpo)
Idempotency-Key: AJ-7K2Q                      (o protocolo; o mesmo pedido não pode duplicar)
```

```json
{
  "tipo": "pedido_ajuda",
  "external_id": "1234567",
  "protocolo": "AJ-7K2Q",
  "origem": "travei",
  "prioridade": "alta",
  "texto": "Pedido de ajuda AJ-7K2Q · 28/10 14:32 · Ana Souza · RGM 1234567 ...",
  "campos": { "aluno": {}, "motivo": "", "onde": {}, "tentou": {}, "progresso": {}, "dispositivo": "", "ultimos_eventos": [], "link_percurso": "" },
  "link_percurso": "https://app.cruzeiroead.com.br/admin#acompanhamento/aluno/482",
  "criado_em": "2026-10-28T17:32:00.000Z"
}
```

Os valores de `origem` são estes:

| Valor | O que aconteceu |
|---|---|
| `travei` | o aluno tocou em "Travei" |
| `quiz_erros` | errou 2 vezes a mesma pergunta |
| `video_pausas` | pausou o vídeo 3 vezes antes de 90% |
| `busca_vazia` | fez 2 buscas sem resultado na Central |
| `certificado_erro` | deu erro ao gerar o certificado |
| `parado` | ficou 4 min parado no módulo |
| `ajuda_painel` | escolheu "Falar com a equipe" no painel de ajuda |

O que o Bwipo deve fazer:
- **Rejeitar** o pedido se a assinatura não conferir ou se o `X-Timestamp` tiver mais de 5 min.
- **Anexar o `texto` como nota interna** na conversa aberta daquele `external_id`. Se não houver conversa, criar uma na fila do polo, com a etiqueta `pedido-ajuda`.
- **Responder** `200 { "conversation_id": "...", "url": "..." }`. O portal guarda o `conversation_id` em `crm_ref`.

O pacote não leva nada digitado em formulários, nem senha, CPF ou IP. A única exceção é o termo de busca, com sequências de 6 ou mais dígitos mascaradas.

## 3. Retorno de situação (CRM → portal), a fazer

Quando o atendente atender ou resolver, o CRM chama o portal com a mesma assinatura. Assim, o admin atualiza o pedido e o portal para de oferecer ajuda ao aluno.

```
POST /api/integracao/pedidos/{protocolo}/situacao   { "situacao": "em_atendimento" | "resolvido" }
```

A rota ainda não existe no portal. Ela entra quando o Bwipo confirmar o item 2.

## Perguntas em aberto para o Bwipo

1. O WhatsApp do polo também cai no inbox do Bwipo? Se cair, o protocolo na primeira mensagem já liga a conversa ao pedido.
2. Qual é a data para `identify`, `open({ message })` e o recebimento do item 2?

## Privacidade

- O rastreio é ligado ao RGM, então precisa estar na política de privacidade antes de `RASTREIO_LIBERADO_PARA=*`.
- A oferta de ajuda avisa o aluno: "A equipe do seu polo vai ver em que parte do portal você está".
