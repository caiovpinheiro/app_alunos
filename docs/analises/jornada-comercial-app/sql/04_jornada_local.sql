-- 04_jornada_local.sql — junta as extrações 01 (CRM) e 02 (app) num Postgres LOCAL e calcula a jornada.
-- Roda no banco local criado por rodar.sh (nunca nos bancos de produção).
-- Variáveis psql: de, ate (dias da venda, horário de Brasília, 'AAAA-MM-DD'; ate é exclusivo).
-- Tabelas de entrada (texto, como vieram do CSV): crm_vendas, app_alunos.

\pset pager off
\pset null ''

create or replace function hh(a timestamptz, b timestamptz) returns numeric
  language sql immutable as $$ select (extract(epoch from b - a) / 3600)::numeric $$;

drop view if exists c cascade;
drop view if exists j cascade;
create view j as
with v as (select distinct on (k) * from crm_vendas order by k, venda_em),
a as (select distinct on (k) * from app_alunos order by k, conta_em)
select v.k,
  v.venda_em::timestamptz venda, (v.venda_em::timestamptz at time zone 'America/Sao_Paulo') venda_local,
  nullif(v.lead_em, '')::timestamptz lead, nullif(v.ead_em, '')::timestamptz ead,
  nullif(v.bv_inicio, '')::timestamptz bv_ini, nullif(v.bv_enviado, '')::timestamptz bv, v.bv_falhas::int bv_falhas,
  nullif(v.ead_primeiro_in, '')::timestamptz resp,
  nullif(v.ead_robo_apos_in, '')::timestamptz robo_resp, nullif(v.ead_ia_apos_in, '')::timestamptz ia_resp, nullif(v.ead_humano_apos_in, '')::timestamptz hum_resp,
  nullif(v.com_primeiro_in, '')::timestamptz com_in, nullif(v.com_humano_apos_in, '')::timestamptz com_hum,
  coalesce(nullif(v.origem_lead, ''), '(vazio)') origem, coalesce(v.nivel, '?') nivel, coalesce(v.polo, '?') polo, coalesce(v.curso, '?') curso,
  coalesce(v.tipo_inscricao, '?') tipo_inscricao, v.tem_senha = 't' tem_senha,
  a.k is not null tem_conta, nullif(a.conta_em, '')::timestamptz conta, nullif(a.primeiro_login_em, '')::timestamptz login,
  nullif(a.aula_comecou_em, '')::timestamptz comecou, coalesce(a.modulos, '0')::int modulos,
  nullif(a.aula_concluiu_em, '')::timestamptz concluiu, nullif(a.cert_em, '')::timestamptz cert, a.dispositivo
from v left join a using (k);

create view c as
select *, extract(hour from venda_local)::int hora, extract(isodow from venda_local)::int dow
from j where venda_local >= (:'de')::date and venda_local < (:'ate')::date;

\echo '== 1. Mapa da jornada (coorte de vendas)'
select 'vendas' etapa, count(*) n, null::numeric pct, null::text mediana from c
union all select 'lead → venda (leads criados ≥ 28/09)', count(*) filter (where lead >= '2026-09-28'), null,
  (percentile_cont(0.5) within group (order by hh(lead, venda)) filter (where lead >= '2026-09-28'))::numeric(8,1) || ' h' from c
union all select 'venda → negócio no Acadêmico', count(ead), (100.0 * count(ead) / count(*))::numeric(4,1),
  (percentile_cont(0.5) within group (order by hh(venda, ead) * 60))::numeric(8,1) || ' min' from c
union all select 'negócio → BV enviada', count(bv), (100.0 * count(bv) / count(*))::numeric(4,1),
  (percentile_cont(0.5) within group (order by hh(ead, bv) * 60))::numeric(8,1) || ' min' from c
union all select 'BV → aluno respondeu (pediu acesso)', count(*) filter (where resp >= bv), (100.0 * count(*) filter (where resp >= bv) / count(*))::numeric(4,1),
  (percentile_cont(0.5) within group (order by hh(bv, resp) * 60) filter (where resp >= bv))::numeric(8,1) || ' min' from c
union all select 'venda → conta no app', count(conta), (100.0 * count(conta) / count(*))::numeric(4,1),
  (percentile_cont(0.5) within group (order by hh(venda, conta) * 60))::numeric(8,1) || ' min' from c
union all select 'BV → 1ª entrada no app', count(login), (100.0 * count(login) / count(*))::numeric(4,1),
  (percentile_cont(0.5) within group (order by hh(bv, login)) filter (where login >= bv))::numeric(8,1) || ' h' from c
union all select '1ª entrada → começou a Aula', count(comecou), (100.0 * count(comecou) / count(*))::numeric(4,1),
  (percentile_cont(0.5) within group (order by hh(login, comecou) * 60) filter (where comecou >= login))::numeric(8,1) || ' min' from c
union all select 'começou → concluiu (7 módulos)', count(concluiu), (100.0 * count(concluiu) / count(*))::numeric(4,1),
  (percentile_cont(0.5) within group (order by hh(comecou, concluiu) * 60))::numeric(8,1) || ' min' from c
union all select 'concluiu → certificado', count(*) filter (where cert >= concluiu - interval '1 min'), (100.0 * count(cert) / count(*))::numeric(4,1),
  (percentile_cont(0.5) within group (order by hh(concluiu, cert) * 60) filter (where cert >= concluiu - interval '1 min'))::numeric(8,1) || ' min' from c
union all select 'venda → certificado (total)', count(cert), null,
  (percentile_cont(0.5) within group (order by hh(venda, cert)))::numeric(8,1) || ' h' from c;

\echo '== 2. Onde se perde, por corte (taxas sobre as vendas do grupo)'
select 'nivel' corte, nivel faixa, count(*) n, (100.0*count(bv)/count(*))::numeric(4,0) bv, (100.0*count(login)/count(*))::numeric(4,0) entrou,
  (100.0*count(comecou)/count(*))::numeric(4,0) comecou, (100.0*count(concluiu)/count(*))::numeric(4,0) concluiu, (100.0*count(cert)/count(*))::numeric(4,0) cert
from c group by 2
union all select 'origem', origem, count(*), (100.0*count(bv)/count(*))::numeric(4,0), (100.0*count(login)/count(*))::numeric(4,0),
  (100.0*count(comecou)/count(*))::numeric(4,0), (100.0*count(concluiu)/count(*))::numeric(4,0), (100.0*count(cert)/count(*))::numeric(4,0) from c group by 2
union all select 'tipo_inscricao', tipo_inscricao, count(*), (100.0*count(bv)/count(*))::numeric(4,0), (100.0*count(login)/count(*))::numeric(4,0),
  (100.0*count(comecou)/count(*))::numeric(4,0), (100.0*count(concluiu)/count(*))::numeric(4,0), (100.0*count(cert)/count(*))::numeric(4,0) from c group by 2
union all select 'polo (≥10)', polo, count(*), (100.0*count(bv)/count(*))::numeric(4,0), (100.0*count(login)/count(*))::numeric(4,0),
  (100.0*count(comecou)/count(*))::numeric(4,0), (100.0*count(concluiu)/count(*))::numeric(4,0), (100.0*count(cert)/count(*))::numeric(4,0) from c group by 2 having count(*) >= 10
union all select 'curso (≥10)', curso, count(*), (100.0*count(bv)/count(*))::numeric(4,0), (100.0*count(login)/count(*))::numeric(4,0),
  (100.0*count(comecou)/count(*))::numeric(4,0), (100.0*count(concluiu)/count(*))::numeric(4,0), (100.0*count(cert)/count(*))::numeric(4,0) from c group by 2 having count(*) >= 10
union all select 'hora da venda', case when hora < 12 then 'a) até 11h' when hora < 14 then 'b) 12–13h' when hora < 18 then 'c) 14–17h' when hora < 21 then 'd) 18–20h' else 'e) 21–23h' end,
  count(*), (100.0*count(bv)/count(*))::numeric(4,0), (100.0*count(login)/count(*))::numeric(4,0),
  (100.0*count(comecou)/count(*))::numeric(4,0), (100.0*count(concluiu)/count(*))::numeric(4,0), (100.0*count(cert)/count(*))::numeric(4,0) from c group by 2
union all select 'dia da venda (1=seg)', dow::text, count(*), (100.0*count(bv)/count(*))::numeric(4,0), (100.0*count(login)/count(*))::numeric(4,0),
  (100.0*count(comecou)/count(*))::numeric(4,0), (100.0*count(concluiu)/count(*))::numeric(4,0), (100.0*count(cert)/count(*))::numeric(4,0) from c group by 2
union all select 'BV', case when ead is null then 'a) sem negócio no Acadêmico' when bv_ini is null and ead < venda - interval '1 day' then 'b) não disparou: negócio já existia'
    when bv_ini is null then 'c) não disparou: outro motivo' when bv is null then 'd) disparou, envio falhou' else 'e) enviada' end,
  count(*), (100.0*count(bv)/count(*))::numeric(4,0), (100.0*count(login)/count(*))::numeric(4,0),
  (100.0*count(comecou)/count(*))::numeric(4,0), (100.0*count(concluiu)/count(*))::numeric(4,0), (100.0*count(cert)/count(*))::numeric(4,0) from c group by 2
union all select 'senha no negócio', tem_senha::text, count(*), (100.0*count(bv)/count(*))::numeric(4,0), (100.0*count(login)/count(*))::numeric(4,0),
  (100.0*count(comecou)/count(*))::numeric(4,0), (100.0*count(concluiu)/count(*))::numeric(4,0), (100.0*count(cert)/count(*))::numeric(4,0) from c group by 2
union all select 'aparelho (só quem entrou)', coalesce(dispositivo, '?'), count(*), null, 100,
  (100.0*count(comecou)/count(*))::numeric(4,0), (100.0*count(concluiu)/count(*))::numeric(4,0), (100.0*count(cert)/count(*))::numeric(4,0) from c where login is not null group by 2
order by 1, 2;

\echo '== 2b. Começou a Aula e parou: módulos concluídos'
select modulos, count(*) from c where comecou is not null and concluiu is null group by 1 order by 1;

\echo '== 3. Acadêmico: quem respondeu primeiro à 1ª mensagem do aluno'
select case when least(robo_resp, ia_resp, hum_resp) is null then 'ninguém' when robo_resp = least(robo_resp, ia_resp, hum_resp) then 'robô (fluxo da BV)'
    when ia_resp = least(robo_resp, ia_resp, hum_resp) then 'IA de acolhimento' else 'pessoa' end quem,
  count(*) n, (percentile_cont(0.5) within group (order by hh(resp, least(robo_resp, ia_resp, hum_resp)) * 60))::numeric(8,1) mediana_min,
  (100.0*count(login)/count(*))::numeric(4,0) entrou, (100.0*count(comecou)/count(*))::numeric(4,0) comecou, (100.0*count(cert)/count(*))::numeric(4,0) cert
from c where resp is not null group by 1 order by 2 desc;

select 'IA de acolhimento' quem, count(ia_resp) n, (percentile_cont(0.5) within group (order by hh(resp, ia_resp) * 60))::numeric(8,1) mediana_min
from c union all
select 'pessoa', count(hum_resp), (percentile_cont(0.5) within group (order by hh(resp, hum_resp) * 60))::numeric(8,1) from c;

\echo '== 3b. Comercial: 1ª resposta de uma pessoa ao lead x app'
select case when com_in is null then 'z) lead não escreveu' when com_hum is null then 'y) sem pessoa'
    when hh(com_in, com_hum) * 60 < 5 then 'a) < 5 min' when hh(com_in, com_hum) * 60 < 30 then 'b) 5–30 min'
    when hh(com_in, com_hum) < 2 then 'c) 30 min–2 h' when hh(com_in, com_hum) < 24 then 'd) 2–24 h' else 'e) > 24 h' end faixa,
  count(*) n, (100.0*count(login)/count(*))::numeric(4,0) entrou, (100.0*count(comecou)/count(*))::numeric(4,0) comecou, (100.0*count(cert)/count(*))::numeric(4,0) cert
from c group by 1 order by 1;

\echo '== 4. Evolução por dia da 1ª entrada (efeito das mudanças no app)'
select (login at time zone 'America/Sao_Paulo')::date dia, count(*) entraram, (100.0*count(comecou)/count(*))::numeric(4,0) comecou,
  (100.0*count(concluiu)/count(*))::numeric(4,0) concluiu, (100.0*count(cert)/count(*))::numeric(4,0) cert
from j where login >= (:'de')::date group by 1 order by 1;

\echo '== 5. Semanas de venda: BV e entrada no app (todo o período extraído)'
select date_trunc('week', venda_local)::date semana, count(*) vendas, (100.0*count(bv)/count(*))::numeric(4,0) bv,
  (100.0*count(*) filter (where resp >= bv)/count(*))::numeric(4,0) respondeu, (100.0*count(login)/count(*))::numeric(4,0) entrou,
  (100.0*count(comecou)/count(*))::numeric(4,0) comecou, (100.0*count(cert)/count(*))::numeric(4,0) cert
from j group by 1 order by 1;
