# Jornada do aluno: do comercial ao certificado (análise de 06/11/2026)

Consultas só de leitura no CRM Bwipo (`db_crm`) e no banco do App do Aluno, cruzadas pelo RGM (em hash). Nada aqui identifica aluno ou atendente: só contagens, taxas e medianas.

## Bases e cortes

| Parte | Coorte | n |
|---|---|---|
| Venda, Acadêmico e BV | vendas de 01/10 a 06/11 | 1.836 alunos |
| App (entrada, Aula, certificado) | vendas de **29/10 a 05/11**, desde que o acesso ao app entrou na BV | 367 alunos |
| Funil do comercial (lead → venda) | negócios criados no Comercial de 01/10 a 29/10 | 25.525 leads, 1.319 vendas (5,2%) |

- **Venda** é a entrada na etapa *Aceite*. O *Ganho* chega cerca de 20 h depois, quando o relatório de matriculados é importado, então ele não serve para medir tempo.
- **Pediu acesso** é a primeira mensagem do aluno no Acadêmico depois da BV. O botão da BV conta como mensagem.
- **Começou a Aula** é ter algum progresso na trilha. **Concluiu** é ter os 7 módulos concluídos.
- **Venda ≈ 1.400 por mês.** Os ganhos estimados abaixo usam essa base.
- **App antes de 29/10:** nas vendas até 26/10, menos de 6% entraram no app. A conta era criada no dia seguinte, pela sincronização, e ninguém era avisado. Por isso a parte do app usa só a coorte de 29/10 em diante.

## 1. Mapa da jornada (vendas de 29/10 a 05/11, n = 367)

| Etapa | Chegaram | % das vendas | Tempo mediano desde a etapa anterior |
|---|---:|---:|---|
| Lead → venda (Aceite) | 350 com lead novo | | **27 h** |
| Venda → negócio no Acadêmico | 364 | 99% | no mesmo minuto |
| Negócio → BV enviada | 325 | **89%** | no mesmo minuto |
| BV → aluno pediu acesso | 301 | 82% | 8 min |
| Venda → conta no app | 356 | 97% | no mesmo minuto |
| BV → 1ª entrada no app | 200 | **55%** | 30 min |
| 1ª entrada → começou a Aula | 110 | **30%** | 18 min |
| Começou → concluiu (7 módulos) | 66 | **18%** | 25 min |
| Concluiu → certificado | 36 | **10%** | 3 h 16 min |
| Venda → certificado (total) | | | 29 h |

Os tempos são bons. Quem segue em frente segue rápido: entra no app 30 min depois da BV e faz a Aula inteira em 25 min.

**O problema é quem para no caminho.** As quatro maiores perdas:

1. **BV → entrada no app:** 45% nunca entram.
2. **Entrada → começou a Aula:** 45% dos que entram não começam.
3. **Começou → concluiu:** 40% dos que começam não concluem.
4. **Concluiu → certificado:** 45% dos que concluem não emitem o certificado.

## 2. Onde se perde mais gente

**Sem senha ou sem BV, o aluno quase não chega ao app.** 57 das 367 vendas (15,5%) ficaram sem a senha no negócio ou sem a BV enviada. Desses, só 12% entraram no app, contra 62% dos demais. Por que a BV não saiu:

| Motivo | Vendas | Entraram no app |
|---|---:|---:|
| O negócio no Acadêmico já existia (rematrícula, lead antigo), e a BV só dispara quando o negócio é criado | 21 | 24% |
| A BV disparou, mas o envio falhou: em 9 de 12 casos a Meta limitou o template de **marketing** | 12 | 0% |
| A BV não disparou por outro motivo | 6 | 17% |
| Sem negócio no Acadêmico | 3 | 0% |
| BV enviada | 325 | 60% |

**Fora do fluxo da BV, a IA de acolhimento não leva ao app.** O que acontece com a primeira mensagem do aluno depende de quem responde primeiro:

| Quem respondeu primeiro | Alunos | Entraram no app | Começaram a Aula |
|---|---:|---:|---:|
| Robô (fluxo da BV) | 283 | **67%** | 37% |
| IA de acolhimento | 36 | **14%** | 11% |
| Pessoa | 10 | 40% | 20% |

Quando o aluno escreve fora do botão e cai na IA, ela responde rápido (mediana de 31 min na coorte, e de segundos quando é a primeira a falar), mas quase nunca entrega o acesso.

**Entrou e não começou.** Dos 44 que começaram e não concluíram, 32 (73%) pararam no módulo 1 sem concluí-lo.

A taxa de começar a Aula depois de entrar mudou com a data da primeira entrada:

| Dia da 1ª entrada | Começaram a Aula |
|---|---:|
| 03/11 | 41% |
| 04/11 | 63% |
| 05/11 | 60% |

As mudanças de 05/11 (Aula direto depois do login) e de 06/11 (celular) vão na direção certa e precisam de mais dias para confirmar. Celular e computador começam na mesma proporção (54% e 57%). No celular, menos gente conclui: 30% dos que entraram, contra 40% no computador.

**Concluiu e não emitiu o certificado.** 30 dos 66 que concluíram (45%) ficaram sem certificado. A emissão depende de um clique, e até 06/11 também de curso e polo.

**Cortes por perfil.** A maioria dos grupos é pequena, então tome como sinais:

- **Nível:** na Pós-graduação, menos gente entra no app (40%, contra 56% na Graduação). Mas quem entra conclui mais: 36% dos alunos de Pós concluem a Aula.
- **Tipo de inscrição:** Regresso, Transferência e Segunda Graduação entram pouco (25% a 43%). Muitos já tinham negócio no Acadêmico e não receberam a BV.
- **Polo:** Santana 2 teve 29% de entrada (14 vendas). Barra Funda tem a maior base (137 vendas) e começa pouco a Aula (23%), contra 42% em Sapopemba.
- **Curso:** Ciências Contábeis e CST em Logística começam pouco a Aula (7% e 10%), com 15 e 10 vendas cada.
- **Origem do lead:** formulário do site, WhatsApp e origem vazia ficam iguais depois da venda: 53% a 57% entram no app. A origem pesa antes, no comercial (seção 3).
- **Hora e dia da venda:** quase não mudam a entrada no app (45% a 60%). As vendas de quarta (04/11) foram melhores porque coincidem com as mudanças no app, não por serem de quarta.

## 3. Tempo de resposta e a chance de venda e de engajamento

**Comercial: a velocidade da primeira resposta pesa na venda.** Leads criados de 01 a 29/10, sem os do Vocacional:

| 1ª resposta de uma pessoa | Horário comercial (seg–sex, 9h–17h) | Fora do horário |
|---|---:|---:|
| < 5 min | **12,8%** viram venda (1.159 leads) | 9,1% (296) |
| 5–30 min | 9,6% (2.686) | 9,9% (535) |
| 30 min–2 h | 8,2% (2.615) | 6,5% (843) |
| 2–24 h | 7,3% (642) | 6,8% (**5.400**) |
| > 24 h | 11,7% (145) | 4,8% (1.908) |

- **Noite:** a resposta leva a mediana de **11 a 15 h** para mensagens das 18h às 23h. Essas mensagens viram venda em 6% a 7% dos casos, contra 8% a 9% de dia.
- **Fim de semana:** a mediana de resposta é **35 h no sábado e 22 h no domingo**, e a venda cai para 5,2% e 5,4%, contra cerca de 8% de segunda a sexta.
- **IA no comercial:** a IA praticamente não atua no comercial. Foram 44 mensagens desde 01/10, contra 43 mil no Acadêmico.
- **Lead que nunca escreveu:** um terço dos leads (8.482, quase todos de formulário) nunca mandou mensagem, e só 0,4% virou venda.
- **Correlação, não causa:** é possível que os atendentes respondam primeiro os leads mais quentes. Mesmo assim, dentro do horário comercial a escada é limpa até 2–24 h. A faixa de mais de 24 h é pequena (145 leads) e destoa.

**Depois da venda, o efeito da resposta do comercial é pequeno.** Entre os vendidos:

| 1ª resposta do comercial | Entraram no app | Começaram a Aula | Certificado |
|---|---:|---:|---:|
| < 5 min | 60% | 38% | 15% |
| > 24 h | 46% | 27% | 8% |

Os grupos têm 53 e 37 alunos, então é só um indício.

**No Acadêmico, o que decide é o caminho, não o tempo.** O robô da BV responde no mesmo segundo e leva 67% ao app. A IA responde em segundos e leva só 14% (seção 2). As pessoas respondem com mediana de **12 h** depois da primeira mensagem do aluno, então não pesam no primeiro acesso, que acontece em 30 min.

## 4. Recomendações

Os ganhos são estimados sobre cerca de 1.400 vendas por mês, com as taxas da coorte de 29/10 a 05/11. Nas recomendações 6 e 7 o ganho vem de uma correlação: considere metade como cenário prudente.

| # | O que fazer | Onde mexer | Ganho estimado |
|---|---|---|---|
| 1 | **Garantir senha e BV para todo vendido.** Disparar a BV pela venda (o n8n chama a automação, ou o gatilho passa a ser "campo RGM preenchido") e não por "negócio criado", que falha quando o negócio no Acadêmico já existia. Manter o template de **utilidade** (a troca foi feita em 06/11) e o fallback para o caso de a Meta bloquear. Alertar quando um vendido ficar 15 min sem senha. | CRM (BV - Calouros) e n8n | 57 de cada 367 vendas (15,5%) entram a 12%, contra 62%: **cerca de 105 alunos a mais no app por mês** (+8 pontos) |
| 2 | **IA de acolhimento entrega o acesso.** Quando um calouro sem primeiro acesso escreve fora do botão, a IA deve mandar o link pessoal ou a senha do negócio na hora, ou devolver para o fluxo da BV. | CRM (instruções e ferramenta da IA) | 11% dos que respondem caem na IA e entram a 14%, contra 67%: **cerca de 70 a mais por mês** |
| 3 | **Link pessoal de um toque para todos, e lembrete em 24 h.** O link pessoal começou em 06/11 e só 5 vendas da coorte o receberam. Gerar no n8n para toda venda e usar `?o=bv` e `?o=reenvio` para medir. | n8n e CRM | Hoje 39% dos que pedem acesso não entram. Cair para 25% dá **cerca de 150 a mais por mês**: é hipótese, validar em 2 semanas |
| 4 | **Certificado automático ao concluir.** Emitir no servidor ao concluir o 7º módulo e mandar o PDF pela régua (`cert`), sem depender do clique. | App e régua | 45% dos concluintes ficam sem certificado: **cerca de 110 certificados a mais por mês** (de 10% para cerca de 18% das vendas) |
| 5 | **Destravar o módulo 1.** 73% dos que começam e param, param nele. Manter as mudanças de 05 e 06/11 e acompanhar. Se a pessoa ficar parada 10 min no módulo 1, oferecer ajuda humana pelo chat. | App e operação | Reduzir à metade quem para no módulo 1 dá **cerca de 60 concluintes a mais por mês** |
| 6 | **Cobertura do comercial à noite e no fim de semana.** Ligar a IA comercial (etapa "Atendimento IA", hoje sem uso) ou um plantão para responder em menos de 5 min fora do horário, com qualificação e o link de inscrição. | CRM e operação | 80% dos leads fora do horário esperam mais de 2 h. Levar a conversão deles de 6,3% para cerca de 9% dá **+100 a 200 vendas por mês** |
| 7 | **Resposta em menos de 5 min no horário comercial.** Redistribuir para outro atendente quando o lead fica 5 min sem resposta e mostrar a fila por atendente. | CRM (distribuição) e operação | Levar parte dos leads de 30 min a 2 h para menos de 5 min (8,2% → 12,8%) dá **+50 a 150 vendas por mês** |
| 8 | **Dados para medir.** Preencher `origem_do_lead` (vazio em 21% dos leads), gravar a hora do Aceite como data da venda no Acadêmico, passar o `?o=` nos links e registrar o clique em "pedir acesso" (webhook da régua). | CRM e n8n | Não muda a conversão: deixa medir 1 a 7 sem consulta manual |

Ordem sugerida: 1, 2 e 4 primeiro, porque são baratas e têm ganho direto. Depois 3 e 5 com medição, e 6 e 7 junto com a gestão do comercial.

## Limites

- **Coorte pequena:** a parte do app tem 8 dias de vendas (367). Cortes com menos de 30 alunos são só sinais.
- **Coortes recentes:** as vendas de 04 e 05/11 tiveram menos tempo para entrar e concluir, então as taxas finais devem subir um pouco.
- **Leads antes de 28/09:** o CRM do comercial começa em 21/09, numa importação. Por isso o tempo lead → venda usa só leads criados a partir de 28/09.
- **Origem da entrada e falhas de login:** só são medidas desde 06/11, então ainda não entram nesta análise.
- **Banco do agente comercial (`leads_ganhos`):** não foi usado. O CRM já traz a venda, o RGM, o curso e a data de matrícula.
- **Correlação:** o tempo de resposta e a conversão andam juntos, mas não provam causa. Para confirmar, testar a recomendação 6 num período e comparar.

As consultas e o passo a passo para rodar de novo estão no [README](README.md).
