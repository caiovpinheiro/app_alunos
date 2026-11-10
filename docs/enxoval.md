# Enxoval do calouro

Atualizado em 10/11/2026. Kit para o calouro de Graduação EaD que **não quer entrar no app agora** ou **não responde** a régua de boas-vindas (`docs/regua-calouro.md`). Chega pelo WhatsApp em peças curtas: mensagens intercaladas com 5 artes e um guia em PDF para guardar.

**Estado (10/11/2026):** as artes e o PDF estão no ar. Os dois templates foram enviados à Meta como utilidade e esperam aprovação. Nenhum gatilho está ligado. O primeiro envio é só para o dono do projeto, como teste.

## Peças

Todas ficam em `public/enxoval/`. Depois do deploy, saem em `https://app.cruzeiroead.com.br/enxoval/<arquivo>`, que é o endereço público que o WhatsApp precisa para mandar a imagem ou o documento.

| Arquivo | Conteúdo |
|---|---|
| `arte-1-aplicativos.png` | Baixe os 2 aplicativos: Duda e Microsoft Authenticator |
| `arte-2-senha.png` | Primeira senha: 3 letras do nome + @ + 3 números do RGM + 4 do CPF, com exemplo (`Ana@5129876`). Avisa que o link do e-mail acadêmico vem na mensagem |
| `arte-3-entrar.png` | Criar a senha e ligar o Authenticator, login no Duda, SIM no Authenticator, Acessar Blackboard |
| `arte-4-mensalidade.png` | Vence dia 25. Até o dia 10, 25%; do 11 ao 25, 15%; depois do 25 perde só o desconto de pontualidade. 1ª mensalidade com desconto total até o dia 25. Como pagar |
| `arte-5-disciplinas.png` | Uma matéria por mês, Ambientação Digital em até 3 dias, prazo no dia 1º, nota A2 (até 4) + A1 (até 6), média 6 |
| `guia-do-calouro.pdf` | 4 páginas: primeiro acesso, onde fica cada coisa, Área do Aluno, disciplinas, notas e provas, tutor, mensalidade, ajuda e lista da primeira semana. Os links são clicáveis |

Formato: artes de 1080 × 1350 (retrato do WhatsApp), PDF em A4. As cores são as da Aula Inaugural e os ícones dos apps são as artes oficiais, sem alteração.

**Fonte dos fatos:** as legendas da Aula Inaugural (`public/trilha-midia/aula/cap_01.txt` a `cap_07.txt`) e o módulo 1 de `server/assets/trilha.json`. Se a Aula mudar (senha, prazos, descontos, notas), mude aqui também e gere as peças de novo.

### Gerar de novo

```bash
tools/enxoval/render.sh
```

O script usa o Google Chrome sem janela e internet para as fontes. As fontes das peças são `tools/enxoval/arte-*.html` e `tools/enxoval/guia.html`, e as cores comuns ficam em `tools/enxoval/arte.css`.

## Sequência no WhatsApp

Fora da janela de 24 h só sai template aprovado, com no máximo uma imagem ou um documento. Por isso o kit começa com um template e o aluno toca para receber o resto: o toque abre a janela, e a partir daí as peças saem como mensagens comuns.

### 1. Abertura: template `enxoval_calouro`

Cabeçalho: imagem `arte-1-aplicativos.png`.

> Olá, {{1}}! Sua matrícula está ativa e separamos o seu enxoval de calouro: o passo a passo do primeiro acesso, a mensalidade e as disciplinas, em imagens curtas e um guia para guardar. Toque em RECEBER MEU ENXOVAL e mandamos tudo aqui.

Botões (resposta rápida): **Receber meu enxoval** · **Agora não**.

### 2. Ao tocar em "Receber meu enxoval" (mensagens comuns, janela aberta)

| # | Tipo | Conteúdo |
|---|---|---|
| a | texto | Que bom! São 5 imagens curtas e um guia em PDF. Comece pelos aplicativos 👇 |
| b | imagem `arte-1` | Legenda: *Duda* · iPhone: https://apps.apple.com/br/app/duda/id6451416655 · Android: https://play.google.com/store/apps/details?id=br.com.cruzeirodosulvirtual — *Authenticator* · iPhone: https://apps.apple.com/br/app/microsoft-authenticator/id983156458 · Android: https://play.google.com/store/apps/details?id=com.azure.authenticator |
| c | imagem `arte-2` | Legenda: Descubra o seu e-mail acadêmico com o CPF: https://emailacademico.cruzeiroead.com.br/descobrir |
| d | imagem `arte-3` | Legenda: Crie uma senha só sua e anote num lugar seguro. Ela vale para o curso inteiro. |
| e | texto | Agora, duas coisas importantes para o seu mês: a mensalidade e as disciplinas. |
| f | imagem `arte-4` | Legenda: Para pagar, entre na Área do Aluno: https://novoportal.cruzeirodosul.edu.br/ |
| g | imagem `arte-5` | Legenda: Suas aulas ficam no AVA, que você abre pelo Duda em Acessar Blackboard. |
| h | documento `guia-do-calouro.pdf` | Legenda: Este é o seu guia completo, para guardar. Tem tudo isso e mais: Área do Aluno, notas, tutor e a lista da primeira semana. |
| i | texto com botões | Conseguiu fazer o primeiro acesso? Botões: **Já consegui** (encerra) · **Preciso de ajuda** (fila do Acolhimento) · **Vou fazer depois** (encerra; o lembrete do passo 3 cuida) |

Intervalo sugerido entre as peças: de 3 a 5 s, para chegarem na ordem.

### 3. "Agora não" ou sem resposta: template `enxoval_guia`

Sai 3 dias depois, só se o aluno ainda não entrou na faculdade nem no app. A checagem é a mesma do Follow-up pós-link, pelo campo `situacao_acesso_app`.

Cabeçalho: documento `guia-do-calouro.pdf`.

> Olá, {{1}}! Deixamos aqui o seu guia do calouro, com o primeiro acesso, a mensalidade e as disciplinas. Guarde para quando for a hora. Se travou em algum passo, responda esta mensagem contando onde parou.

Botões (resposta rápida): **Preciso de ajuda** · **Já consegui**.

Os dois templates são de **utilidade**: falam da matrícula que já existe, sem oferta nem promoção. `{{1}}` é o primeiro nome. A Meta recusa corpo que começa ou termina com a variável, por isso os dois abrem com "Olá, {{1}}!". Foram criados pela tela Configurações › Modelos de mensagem do CRM, no canal oficial, com a mídia de exemplo das peças publicadas.

## Gatilhos possíveis (nenhum ligado)

| Momento da régua | Hoje | Com o enxoval |
|---|---|---|
| `bv_app2` sem toque por 24 h | passa para uma pessoa do Acolhimento | também recebe `enxoval_calouro` |
| Pós-Graduação toca em "Chamo Depois" | sem continuação definida | (só depois de fazer as peças de Pós: as regras de mensalidade e de disciplinas da Aula são da Graduação) |
| Fim do Follow-up pós-link sem entrar | fim | recebe `enxoval_guia` |

## Medição

O link do app no PDF leva a origem `?o=enxoval_pdf`, e a entrada aparece na aba Medição por origem. No CRM, conte os toques em "Receber meu enxoval", "Já consegui" e "Preciso de ajuda".

## Próximos passos

1. ~~Publicar as peças~~ (PR #17, 10/11).
2. ~~Mandar `enxoval_calouro` e `enxoval_guia` para aprovação da Meta~~ (10/11, aguardando).
3. Teste só com o número do dono do projeto: uma automação desligada para os alunos e disparada à mão.
4. Escolher os gatilhos e ligar, com cópia da automação antes da mudança (regra do `docs/regua-calouro.md`).
