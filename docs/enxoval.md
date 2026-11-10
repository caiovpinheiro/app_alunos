# Enxoval do calouro

Criado em 10/11/2026. Kit para o calouro que **não quer entrar no app agora** ou **não responde** a régua (`docs/regua-calouro.md`): uma página aberta, sem login, e até três templates curtos no WhatsApp apontando para ela.

**Estado:** página pronta neste PR; templates escritos, ainda não enviados para aprovação da Meta; nenhum gatilho ligado. Por enquanto o envio é só para o dono do projeto, como teste.

## Página `/enxoval`

`public/enxoval.html`, rota em `server/index.js` (ao lado de `/como-funciona`). Mesmo visual da página Como funciona.

| Seção | O que tem |
|---|---|
| Topo | "Tudo para começar o curso, num lugar só", com atalhos para as quatro seções |
| Primeiro acesso | 5 passos do módulo 1 da Aula Inaugural: baixar Duda e Authenticator, descobrir o e-mail acadêmico (`emailacademico.cruzeiroead.com.br/descobrir`), montar a primeira senha, criar a senha própria e ligar o Authenticator, entrar no Duda. Avisa que a senha da faculdade é diferente da senha do app. |
| Onde fica cada coisa | Duda, AVA (Blackboard), Área do Aluno e o app do aluno |
| Lista da primeira semana | 6 itens para marcar; fica guardada só no aparelho (`localStorage` `csu_enxoval_lista`), sem login e sem envio ao servidor |
| Ajuda | Responder a mensagem do WhatsApp oficial em que o aluno recebeu o link |
| Fim | Botão para entrar no app do aluno |

Os textos seguem `server/assets/trilha.json` (módulo 1) e as legendas `cap_01` e `cap_02`. Se o módulo 1 mudar, mudar aqui também.

A página não tem rastreio (o aluno não está logado). A medição é pela origem: os links de login e da página Como funciona levam o `?o=` com que a página foi aberta, e a entrada aparece na aba Medição por origem.

| Origem | Link |
|---|---|
| `enxoval` | primeiro envio |
| `enxoval_d3` | lembrete de 3 dias |
| `enxoval_d7` | último lembrete |

## Templates (rascunho para a Meta)

Categoria **utilidade**: falam da matrícula que já existe e do acesso, sem oferta nem promoção. `{{1}}` = primeiro nome. Botão de link fixo para `https://app.cruzeiroead.com.br/enxoval?o=<origem>`.

### `enxoval_calouro` (primeiro envio)

> Olá, {{1}}! Sua matrícula está ativa. Para quando você quiser começar, juntamos num só lugar o passo a passo do primeiro acesso à faculdade, onde ficam as aulas e como pedir ajuda. Guarde esta mensagem.

Botões: **Ver meu kit** (link, `?o=enxoval`) · **Quero meu acesso agora** (resposta rápida: segue para a mensagem do link pessoal do BV).

### `enxoval_lembrete` (3 dias depois, só se não entrou)

> {{1}}, o primeiro acesso à faculdade leva uns 10 minutos, e o passo a passo continua no seu kit de calouro. Se travou em algum passo, responda esta mensagem contando onde parou.

Botões: **Abrir o passo a passo** (link, `?o=enxoval_d3`) · **Preciso de ajuda** (resposta rápida: fila do Acolhimento).

### `enxoval_ultimo` (7 dias depois, só se não entrou)

> {{1}}, suas aulas ficam no AVA, que você abre pelo app Duda. Se ainda não fez o primeiro acesso, o passo a passo está no seu kit de calouro. Precisando, é só responder esta mensagem.

Botões: **Ver meu kit** (link, `?o=enxoval_d7`) · **Já consegui** (resposta rápida: encerra).

"Só se não entrou" usa a mesma checagem do Follow-up pós-link (`situacao_acesso_app`, via `POST /api/integracoes/situacao-acesso`).

## Gatilhos possíveis (nenhum ligado)

| Momento da régua | Hoje | Com o enxoval |
|---|---|---|
| `bv_app2` sem toque por 24 h | passa para uma pessoa do Acolhimento | também recebe `enxoval_calouro` |
| Pós-Graduação toca em "Chamo Depois" | sem continuação definida | recebe `enxoval_calouro` |
| Pós-Graduação sem resposta ao `fup_bv_calouros` | registra e encerra | recebe `enxoval_calouro` |
| Fim do Follow-up pós-link sem entrar | fim | recebe `enxoval_lembrete` |

## Próximos passos

1. Publicar a página (este PR).
2. Mandar os três templates para aprovação da Meta pelo CRM.
3. Teste só com o número do dono do projeto: uma automação desligada para os alunos, disparada à mão.
4. Escolher os gatilhos e ligar, com cópia da automação antes da mudança (regra do `docs/regua-calouro.md`).
