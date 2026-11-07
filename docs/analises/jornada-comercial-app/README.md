# Jornada comercial → App do Aluno

Análise da jornada do aluno, do lead no comercial até o certificado da Aula Inaugural, com consultas **só de leitura** no CRM Bwipo e no banco do App do Aluno.

- Relatório de 06/11/2026: [relatorio-2026-11-06.md](relatorio-2026-11-06.md).
- Resultados agregados daquela rodada: [resultados/](resultados/).

## Arquivos

| Arquivo | O que faz | Onde roda |
|---|---|---|
| `configurar-acesso.py` | Cadastra um banco em `~/.pg_service.conf` e a senha em `~/.pgpass`, pedindo a URL sem mostrá-la na tela. Toda sessão abre com `default_transaction_read_only=on`. | seu Mac |
| `sql/01_crm_vendas.sql` | Uma linha por venda do comercial: lead, marcos do negócio (Aceite, RGM), conversa no comercial, negócio no Acadêmico, BV, resposta do aluno, IA e pessoas no Acadêmico. | CRM (`crm_leitura`) |
| `sql/02_app_alunos.sql` | Uma linha por conta do app: conta, 1º login, Aula (começou, módulos, concluiu), certificado, aparelho, origem da entrada, link pessoal. | App (`app_alunos_leitura`) |
| `sql/03_crm_leads.sql` | Funil do comercial por lead: venda por tempo da 1ª resposta de uma pessoa, hora, dia, origem e quem respondeu primeiro. Já sai agregado. | CRM |
| `sql/04_jornada_local.sql` | Junta 01 e 02 pelo RGM em hash e calcula o mapa da jornada, os cortes, o "quem respondeu primeiro" e a evolução por dia. | Postgres **local** |
| `rodar.sh` | Roda tudo, nessa ordem. | seu Mac |

## Como rodar de novo

1. **Acesso, uma vez só.** O CRM já tem o usuário `claude_leitura`. O banco do app usa as variáveis `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME` e `DATABASE_USER` do serviço `app_alunos` no EasyPanel.
   ```bash
   python3 docs/analises/jornada-comercial-app/configurar-acesso.py app_alunos_leitura
   ```
   O usuário `claude_leitura` precisa de SELECT nas tabelas de `db_crm` abaixo. Rode como administrador:
   ```sql
   GRANT SELECT ON organizations, pipelines, stages, deals, deal_events, deal_custom_field_values, custom_fields, contacts, contact_custom_field_values, conversations, messages, automations, automation_logs, org_units, tags, tags_on_contacts, tags_on_deals, products, deal_products, departments, tabulations TO claude_leitura;
   GRANT SELECT (id, "organizationId", type, role) ON users TO claude_leitura;
   ```
2. **Rodar.** O primeiro e o segundo argumento definem a coorte da parte do app (dias de venda; o segundo é exclusivo). O terceiro é a pasta de saída: **fora do repositório**.
   ```bash
   docs/analises/jornada-comercial-app/rodar.sh 2026-10-29 2026-11-06 /tmp/jornada
   ```
   Leva cerca de 30 s. Os resultados agregados ficam em `03_leads.txt` e `04_jornada.txt`.
3. **Limpar.** Os CSV intermediários têm uma linha por aluno, com o RGM em hash. Apague a pasta e o banco local:
   ```bash
   rm -rf /tmp/jornada && dropdb -h localhost jornada_tmp
   ```

**Horário:** rode fora do pico. As consultas usam janelas de datas e terminam em menos de 30 s.

## Definições

- **Organizações no CRM:** Comercial = `cmu2t8acw19c5mv01547uh41b` ("Cruzeiro Comercial"). Acadêmico = `cmrmbn2lh0uz2nm016beqgbwb` ("Cruzeiro EaD").
- **Venda:** primeira entrada na etapa *Aceite*. Sem ela, o momento em que o campo RGM foi gravado. Por último, `closedAt`. O *Ganho* é marcado cerca de 1 dia depois, pela importação dos matriculados.
- **Negócio no Acadêmico:** o primeiro negócio com o mesmo RGM.
- **BV enviada:** primeiro passo `send_whatsapp*` com sucesso da automação nº 1 (*BV - Calouros*) naquele negócio.
- **Pediu acesso:** primeira mensagem do aluno no Acadêmico depois da criação do negócio, no limite de 14 dias. O clique no botão conta.
- **Quem respondeu:**
  - *robô*: `authorType = bot` sem `aiAgentUserId`;
  - *IA*: com `aiAgentUserId`;
  - *pessoa*: `authorType = human` sem IA.
  Mensagens privadas nunca contam.
- **No app:**
  - *entrou* é o primeiro login: `primeiro_login_em`, ou a primeira sessão em `csu_acessos`;
  - *começou* é ter alguma linha em `csu_trilha_progresso`;
  - *concluiu* é ter 7 módulos com `concluido_em`;
  - *certificado* é a primeira linha em `csu_certificados`.
- **Chave entre os bancos:** `md5(sal || RGM só com dígitos)`. O sal vem da variável `SAL` e é o mesmo nas duas extrações.

## Regras seguidas

- **Só SELECT.** Nada de INSERT, UPDATE ou DDL nos bancos de produção. As sessões abrem com `default_transaction_read_only=on`. A junção roda num Postgres local.
- **Nada que identifique alguém.** Resultados e relatório não têm nome, telefone, e-mail, CPF nem RGM. Nome de curso e de polo aparecem só agregados.
- **Nenhuma senha no repositório.** As credenciais ficam em `~/.pgpass`, fora do repositório.
