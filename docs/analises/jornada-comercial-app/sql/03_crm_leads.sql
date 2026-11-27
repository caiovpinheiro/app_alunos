-- 03_crm_leads.sql — funil do comercial por lead: tempo de primeira resposta (robô, IA, pessoa) e venda.
-- Banco: db_crm (serviço crm_leitura). Só SELECT. Saída agregada (sem contato, sem pessoa).
-- Variáveis psql: desde, ate (data de criação do negócio no Comercial, 'AAAA-MM-DD').
-- Use janelas que terminem pelo menos 7 dias antes de hoje (90% das vendas saem em até 7 dias).
-- Venda = negócio na etapa ganha OU que passou por "Aceite" (o Ganho chega 1 dia depois).

\set com '''cmu2t8acw19c5mv01547uh41b'''

with d as (
  select d.id, d."contactId", d."createdAt" lead_em, s."isWon" ganho,
    exists (select 1 from deal_events e where e."dealId" = d.id and e.type = 'STAGE_CHANGED' and e.meta->'to'->>'name' = 'Aceite') aceite,
    (select v.value from deal_custom_field_values v join custom_fields f on f.id = v."customFieldId" and f.name = 'origem_do_lead'
       where v."dealId" = d.id) origem
  from deals d join stages s on s.id = d."stageId"
  where d."organizationId" = :com
    and d."createdAt" >= (:'desde')::date and d."createdAt" < (:'ate')::date
),
m as (
  select d.id,
    min(x."createdAt") filter (where x.direction = 'in') primeiro_in
  from d join conversations c on c."contactId" = d."contactId" and c."organizationId" = :com
  join messages x on x."conversationId" = c.id and x."createdAt" >= d.lead_em - interval '1 hour' and x."createdAt" < d.lead_em + interval '14 days'
  group by 1
),
r as (
  select d.id,
    min(x."createdAt") filter (where x."authorType" = 'bot' and x."aiAgentUserId" is null) robo,
    min(x."createdAt") filter (where x."aiAgentUserId" is not null) ia,
    min(x."createdAt") filter (where x."authorType" = 'human' and x."aiAgentUserId" is null) pessoa
  from d join m on m.id = d.id
  join conversations c on c."contactId" = d."contactId" and c."organizationId" = :com
  join messages x on x."conversationId" = c.id and x.direction = 'out' and not x."isPrivate"
   and x."createdAt" > m.primeiro_in and x."createdAt" < d.lead_em + interval '14 days'
  group by 1
),
t as (
  select d.*, m.primeiro_in, r.robo, r.ia, r.pessoa,
    extract(epoch from r.pessoa - m.primeiro_in) / 60 min_pessoa,
    extract(hour from (coalesce(m.primeiro_in, d.lead_em) at time zone 'UTC') at time zone 'America/Sao_Paulo')::int hora,
    extract(isodow from (coalesce(m.primeiro_in, d.lead_em) at time zone 'UTC') at time zone 'America/Sao_Paulo')::int dow
  from d left join m on m.id = d.id left join r on r.id = d.id
)
select 'resposta_pessoa' corte,
  case when primeiro_in is null then 'z) lead não escreveu' when pessoa is null then 'y) nenhuma pessoa respondeu'
       when min_pessoa < 5 then 'a) < 5 min' when min_pessoa < 30 then 'b) 5–30 min' when min_pessoa < 120 then 'c) 30 min–2 h'
       when min_pessoa < 1440 then 'd) 2–24 h' else 'e) > 24 h' end faixa,
  count(*) leads, count(*) filter (where ganho or aceite) vendas,
  round(100.0 * count(*) filter (where ganho or aceite) / count(*), 2) pct_venda,
  round((percentile_cont(0.5) within group (order by min_pessoa))::numeric, 1) mediana_min
from t group by 1, 2
union all
select 'hora_1a_msg', lpad(hora::text, 2, '0') || 'h', count(*), count(*) filter (where ganho or aceite),
  round(100.0 * count(*) filter (where ganho or aceite) / count(*), 2),
  round((percentile_cont(0.5) within group (order by min_pessoa))::numeric, 1)
from t where primeiro_in is not null group by 1, 2
union all
select 'dia_semana', dow::text, count(*), count(*) filter (where ganho or aceite),
  round(100.0 * count(*) filter (where ganho or aceite) / count(*), 2),
  round((percentile_cont(0.5) within group (order by min_pessoa))::numeric, 1)
from t where primeiro_in is not null group by 1, 2
union all
select 'origem', coalesce(nullif(origem, ''), '(vazio)'), count(*), count(*) filter (where ganho or aceite),
  round(100.0 * count(*) filter (where ganho or aceite) / count(*), 2),
  round((percentile_cont(0.5) within group (order by min_pessoa))::numeric, 1)
from t group by 1, 2
union all
select 'quem_primeiro',
  case when primeiro_in is null then 'lead não escreveu' when coalesce(robo, ia, pessoa) is null then 'ninguém'
       when robo = least(robo, ia, pessoa) then 'robô' when ia = least(robo, ia, pessoa) then 'IA' else 'pessoa' end,
  count(*), count(*) filter (where ganho or aceite),
  round(100.0 * count(*) filter (where ganho or aceite) / count(*), 2),
  round((percentile_cont(0.5) within group (order by min_pessoa))::numeric, 1)
from t group by 1, 2
union all
-- Mesmo corte de resposta, separado em horário comercial (seg–sex, 9h–17h) e fora dele, sem os leads do Vocacional
select case when hora between 9 and 17 and dow <= 5 then 'resposta_horario_comercial' else 'resposta_fora_do_horario' end,
  case when pessoa is null then 'y) nenhuma pessoa respondeu' when min_pessoa < 5 then 'a) < 5 min' when min_pessoa < 30 then 'b) 5–30 min'
       when min_pessoa < 120 then 'c) 30 min–2 h' when min_pessoa < 1440 then 'd) 2–24 h' else 'e) > 24 h' end,
  count(*), count(*) filter (where ganho or aceite),
  round(100.0 * count(*) filter (where ganho or aceite) / count(*), 2),
  round((percentile_cont(0.5) within group (order by min_pessoa))::numeric, 1)
from t where primeiro_in is not null and coalesce(origem, '') <> 'Vocacional' group by 1, 2
order by 1, 2;
