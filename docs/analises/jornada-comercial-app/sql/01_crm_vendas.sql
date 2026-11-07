-- 01_crm_vendas.sql — uma linha por venda do comercial, com o que aconteceu antes (lead, conversa)
-- e depois (negócio no Acadêmico, BV, resposta do aluno) dentro do CRM Bwipo.
-- Banco: db_crm (serviço crm_leitura). Só SELECT.
-- Variáveis psql: desde, ate (data da venda, 'AAAA-MM-DD'), sal (texto para o hash do RGM).
-- Saída: sem nome, telefone, e-mail, CPF ou RGM; o RGM vira k = md5(sal || rgm só com dígitos).
-- Horários em UTC (ISO). Todas as colunas de data do Prisma são timestamp sem fuso, gravadas em UTC.
--
-- Organizações: Comercial = 'cmu2t8acw19c5mv01547uh41b' ("Cruzeiro Comercial");
--               Acadêmico = 'cmrmbn2lh0uz2nm016beqgbwb' ("Cruzeiro EaD").
-- Venda = primeira entrada na etapa "Aceite" ou, se não houver, o momento em que o RGM foi gravado,
-- ou, por fim, closedAt. O "Ganho" (closedAt) chega cerca de 1 dia depois, quando o relatório de
-- matriculados é importado, por isso não serve como hora da venda.

\set com '''cmu2t8acw19c5mv01547uh41b'''
\set ead '''cmrmbn2lh0uz2nm016beqgbwb'''

with cf as (
  select id, name, "organizationId" org from custom_fields
  where "organizationId" in (:com, :ead) and entity = 'deal'
),
won as (
  select d.id, d."contactId", d."createdAt" lead_em, d."closedAt" ganho_em, d."assignedVia", d."ownerId"
  from deals d join stages s on s.id = d."stageId" and s."isWon"
  where d."organizationId" = :com
    and d."closedAt" >= (:'desde')::date - interval '3 days'
    and d."closedAt" <  (:'ate')::date + interval '4 days'
),
v_com as (
  select v."dealId", cf.name, v.value from deal_custom_field_values v
  join cf on cf.id = v."customFieldId" and cf.org = :com
  join won w on w.id = v."dealId"
  where cf.name in ('rgm','origem_do_lead','curso_de_inscricao','grau_new','polo_de_inscricao','tipo_de_inscricao','formacao','modalidade_curso1')
),
marcos as (
  select e."dealId",
    min(e."createdAt") filter (where e.type = 'STAGE_CHANGED' and e.meta->'to'->>'name' = 'Aceite') aceite_em,
    min(e."createdAt") filter (where e.type = 'CUSTOM_FIELD_UPDATED' and e.meta->>'fieldLabel' = 'RGM') rgm_em,
    min(e."createdAt") filter (where e.type = 'STAGE_CHANGED' and e.meta->'to'->>'name' = 'Aguardando Inscrição') aguard_inscr_em,
    min(e."createdAt") filter (where e.type = 'STAGE_CHANGED' and e.meta->'to'->>'name' = 'Inscrição') inscricao_em,
    min(e."createdAt") filter (where e.type = 'STAGE_CHANGED' and e.meta->'to'->>'name' = 'Robô') robo_em,
    count(*) filter (where e.type = 'STAGE_CHANGED') n_mudancas_etapa
  from deal_events e join won w on w.id = e."dealId"
  group by 1
),
base as (
  select w.*, m.aceite_em, m.rgm_em, m.inscricao_em, m.n_mudancas_etapa,
    coalesce(m.aceite_em, m.rgm_em, w.ganho_em) venda_em,
    regexp_replace(max(v.value) filter (where v.name = 'rgm'), '\D', '', 'g') rgm,
    max(v.value) filter (where v.name = 'origem_do_lead') origem_lead,
    max(v.value) filter (where v.name = 'curso_de_inscricao') curso_com,
    max(v.value) filter (where v.name = 'grau_new') grau,
    max(v.value) filter (where v.name = 'polo_de_inscricao') polo_com,
    max(v.value) filter (where v.name = 'tipo_de_inscricao') tipo_inscricao,
    max(v.value) filter (where v.name = 'modalidade_curso1') modalidade
  from won w left join marcos m on m."dealId" = w.id left join v_com v on v."dealId" = w.id
  group by w.id, w."contactId", w.lead_em, w.ganho_em, w."assignedVia", w."ownerId", m.aceite_em, m.rgm_em, m.inscricao_em, m.n_mudancas_etapa
),
vendas as (
  select * from base
  where venda_em >= (:'desde')::date and venda_em < (:'ate')::date + interval '1 day'
    and coalesce(rgm, '') <> ''
),
-- Conversa no Comercial: do lead até a venda
msg_com as (
  select b.id deal_id,
    min(m."createdAt") filter (where m.direction = 'in') primeiro_in,
    min(m."createdAt") filter (where m.direction = 'out' and not m."isPrivate") primeiro_out,
    min(m."createdAt") filter (where m.direction = 'out' and not m."isPrivate" and m."authorType" = 'bot' and m."aiAgentUserId" is null) primeiro_robo,
    min(m."createdAt") filter (where m.direction = 'out' and not m."isPrivate" and m."aiAgentUserId" is not null) primeira_ia,
    min(m."createdAt") filter (where m.direction = 'out' and not m."isPrivate" and m."authorType" = 'human' and m."aiAgentUserId" is null) primeiro_humano,
    count(*) filter (where m.direction = 'in') n_in,
    count(*) filter (where m.direction = 'out' and not m."isPrivate" and m."authorType" = 'human') n_humano,
    count(*) filter (where m.direction = 'out' and not m."isPrivate" and m."authorType" = 'bot') n_robo
  from vendas b
  join conversations c on c."contactId" = b."contactId" and c."organizationId" = :com
  join messages m on m."conversationId" = c.id
   and m."createdAt" >= b.lead_em - interval '1 hour' and m."createdAt" <= b.venda_em
  group by 1
),
-- Resposta do humano à primeira mensagem do lead (primeira saída humana depois da primeira entrada)
resp_com as (
  select b.id deal_id,
    min(m."createdAt") filter (where m."authorType" = 'human' and m."aiAgentUserId" is null) humano_apos_in,
    min(m."createdAt") filter (where m."authorType" = 'bot' or m."aiAgentUserId" is not null) auto_apos_in
  from vendas b join msg_com mc on mc.deal_id = b.id
  join conversations c on c."contactId" = b."contactId" and c."organizationId" = :com
  join messages m on m."conversationId" = c.id and m.direction = 'out' and not m."isPrivate"
   and m."createdAt" > mc.primeiro_in and m."createdAt" <= b.venda_em
  group by 1
),
-- Acadêmico: negócio pelo RGM
ead_deal as (
  select distinct on (regexp_replace(v.value, '\D', '', 'g'))
    regexp_replace(v.value, '\D', '', 'g') rgm, d.id ead_id, d."contactId" ead_contact, d."createdAt" ead_em, s.name ead_etapa
  from deals d
  join deal_custom_field_values v on v."dealId" = d.id
  join cf on cf.id = v."customFieldId" and cf.org = :ead and cf.name = 'rgm'
  join stages s on s.id = d."stageId"
  where d."organizationId" = :ead
    and regexp_replace(v.value, '\D', '', 'g') in (select rgm from vendas)
  order by regexp_replace(v.value, '\D', '', 'g'), d."createdAt"
),
v_ead as (
  select e.ead_id,
    max(v.value) filter (where cf.name = 'nivel') nivel,
    max(v.value) filter (where cf.name = 'polo') polo,
    max(v.value) filter (where cf.name = 'curso') curso,
    max(v.value) filter (where cf.name = 'acolhimento') acolhimento,
    bool_or(cf.name = 'senha_painel_eduit' and v.value <> '') tem_senha,
    bool_or(cf.name = 'link_acesso' and v.value <> '') tem_link
  from ead_deal e join deal_custom_field_values v on v."dealId" = e.ead_id
  join cf on cf.id = v."customFieldId" and cf.org = :ead
  group by 1
),
-- Régua BV - Calouros (automação nº 1 do Acadêmico)
bv as (
  select e.ead_id,
    min(l."executedAt") filter (where l.status = 'STARTED') bv_inicio,
    min(l."executedAt") filter (where l."stepType" like 'send_whatsapp%' and l.status = 'SUCCESS') bv_enviado,
    count(*) filter (where l."stepType" like 'send_whatsapp%' and l.status in ('FAILED','FAILED_HANDLED')) bv_falhas,
    count(*) filter (where l."stepType" like 'send_whatsapp%' and l.status = 'SUCCESS') bv_msgs,
    min(l."executedAt") filter (where l."stepType" = 'webhook' and l.status = 'SUCCESS') bv_webhook
  from ead_deal e
  join automation_logs l on l."dealId" = e.ead_id
  join automations a on a.id = l."automationId" and a."organizationId" = :ead and a.number = 1
  group by 1
),
-- Conversa no Acadêmico depois que o negócio foi criado (primeiros 14 dias)
msg_ead as (
  select e.ead_id,
    min(m."createdAt") filter (where m.direction = 'in') ead_primeiro_in,
    min(m."createdAt") filter (where m.direction = 'out' and not m."isPrivate" and m."aiAgentUserId" is not null) ead_primeira_ia,
    min(m."createdAt") filter (where m.direction = 'out' and not m."isPrivate" and m."authorType" = 'human' and m."aiAgentUserId" is null) ead_primeiro_humano,
    count(*) filter (where m.direction = 'in') ead_n_in,
    count(distinct c.id) ead_conversas
  from ead_deal e
  join conversations c on c."contactId" = e.ead_contact and c."organizationId" = :ead
  join messages m on m."conversationId" = c.id
   and m."createdAt" >= e.ead_em and m."createdAt" < e.ead_em + interval '14 days'
  group by 1
),
resp_ead as (
  select e.ead_id,
    min(m."createdAt") filter (where m."aiAgentUserId" is not null) ia_apos_in,
    min(m."createdAt") filter (where m."authorType" = 'human' and m."aiAgentUserId" is null) humano_apos_in,
    min(m."createdAt") filter (where m."authorType" = 'bot' and m."aiAgentUserId" is null) robo_apos_in
  from ead_deal e join msg_ead me on me.ead_id = e.ead_id
  join conversations c on c."contactId" = e.ead_contact and c."organizationId" = :ead
  join messages m on m."conversationId" = c.id and m.direction = 'out' and not m."isPrivate"
   and m."createdAt" > me.ead_primeiro_in and m."createdAt" < e.ead_em + interval '14 days'
  group by 1
)
select
  md5(:'sal' || b.rgm) k,
  to_char(b.lead_em, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') lead_em,
  to_char(b.venda_em, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') venda_em,
  to_char(b.aceite_em, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') aceite_em,
  to_char(b.rgm_em, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') rgm_em,
  to_char(b.ganho_em, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ganho_em,
  b.origem_lead, b.grau, b.tipo_inscricao, b.modalidade, b.curso_com, b.polo_com, b."assignedVia" assigned_via,
  (b."ownerId" is not null) tem_dono, b.n_mudancas_etapa,
  to_char(mc.primeiro_in, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') com_primeiro_in,
  to_char(mc.primeiro_out, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') com_primeiro_out,
  to_char(mc.primeiro_robo, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') com_primeiro_robo,
  to_char(mc.primeira_ia, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') com_primeira_ia,
  to_char(mc.primeiro_humano, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') com_primeiro_humano,
  to_char(rc.humano_apos_in, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') com_humano_apos_in,
  to_char(rc.auto_apos_in, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') com_auto_apos_in,
  mc.n_in com_n_in, mc.n_humano com_n_humano, mc.n_robo com_n_robo,
  to_char(e.ead_em, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ead_em, e.ead_etapa,
  ve.nivel, ve.polo, ve.curso, ve.acolhimento, coalesce(ve.tem_senha, false) tem_senha, coalesce(ve.tem_link, false) tem_link,
  to_char(bv.bv_inicio, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') bv_inicio,
  to_char(bv.bv_enviado, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') bv_enviado,
  coalesce(bv.bv_falhas, 0) bv_falhas, coalesce(bv.bv_msgs, 0) bv_msgs,
  to_char(bv.bv_webhook, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') bv_webhook,
  to_char(me.ead_primeiro_in, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ead_primeiro_in,
  to_char(me.ead_primeira_ia, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ead_primeira_ia,
  to_char(me.ead_primeiro_humano, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ead_primeiro_humano,
  to_char(re.ia_apos_in, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ead_ia_apos_in,
  to_char(re.humano_apos_in, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ead_humano_apos_in,
  to_char(re.robo_apos_in, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ead_robo_apos_in,
  coalesce(me.ead_n_in, 0) ead_n_in, coalesce(me.ead_conversas, 0) ead_conversas
from vendas b
left join msg_com mc on mc.deal_id = b.id
left join resp_com rc on rc.deal_id = b.id
left join ead_deal e on e.rgm = b.rgm
left join v_ead ve on ve.ead_id = e.ead_id
left join bv on bv.ead_id = e.ead_id
left join msg_ead me on me.ead_id = e.ead_id
left join resp_ead re on re.ead_id = e.ead_id
order by b.venda_em;
