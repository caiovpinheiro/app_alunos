-- 02_app_alunos.sql — uma linha por conta do App do Aluno: cadastro, primeiro acesso, Aula Inaugural, certificado.
-- Banco: Postgres do serviço app_alunos (serviço app_alunos_leitura). Só SELECT.
-- Variáveis psql: desde (contas criadas a partir de, 'AAAA-MM-DD'), sal (o mesmo do 01).
-- Saída sem nome, e-mail ou RGM: k = md5(sal || rgm só com dígitos), igual ao 01_crm_vendas.sql.
-- "Começou a Aula" = tem alguma linha em csu_trilha_progresso; "concluiu" = 7 módulos com concluido_em.

with a as (
  select id, regexp_replace(rgm, '\D', '', 'g') rgm, created_at, primeiro_login_em, ultimo_login_em, logins,
         senha_trocada_em, curso, unidade
  from csu_alunos
  where created_at >= (:'desde')::date - interval '7 days'
),
trilha as (
  select p.aluno_id, min(p.criado_em) comecou_em, count(p.concluido_em) modulos,
         max(p.concluido_em) filter (where p.nivel = 1) mod1_em,
         case when count(p.concluido_em) >= 7 then max(p.concluido_em) end concluiu_em
  from csu_trilha_progresso p join a on a.id = p.aluno_id group by 1
),
cert as (
  select c.aluno_id, min(c.created_at) cert_em from csu_certificados c join a on a.id = c.aluno_id group by 1
),
acesso as (
  select x.aluno_id, min(x.inicio) primeiro_acesso, sum(x.segundos_ativos) seg_ativos, count(*) sessoes,
         (array_agg(x.dispositivo order by x.inicio))[1] dispositivo
  from csu_acessos x join a on a.id = x.aluno_id group by 1
),
entrada as (
  select distinct on (e.aluno_id) e.aluno_id, e.origem, e.via, e.criado_em
  from csu_entradas e join a on a.id = e.aluno_id where e.primeira order by e.aluno_id, e.criado_em
),
falhas as (
  select f.aluno_id, count(*) n from csu_login_falhas f join a on a.id = f.aluno_id group by 1
),
links as (
  select l.aluno_id, min(l.criado_em) link_criado, min(l.usado_em) link_usado, count(*) n
  from csu_links_acesso l join a on a.id = l.aluno_id group by 1
),
ev as (
  select e.aluno_id,
    min(e.criado_em) filter (where e.nome = 'aula_aberta_apos_login') aula_aberta,
    count(*) filter (where e.nome = 'trilha_travei') travei,
    count(*) filter (where e.nome = 'pedido_ajuda') pedidos_ajuda
  from csu_eventos e join a on a.id = e.aluno_id group by 1
)
select md5(:'sal' || a.rgm) k,
  to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') conta_em,
  to_char(coalesce(a.primeiro_login_em, ac.primeiro_acesso) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') primeiro_login_em,
  to_char(a.senha_trocada_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') senha_trocada_em,
  coalesce(a.logins, 0) logins,
  to_char(t.comecou_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') aula_comecou_em,
  to_char(t.mod1_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') mod1_em,
  coalesce(t.modulos, 0) modulos,
  to_char(t.concluiu_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') aula_concluiu_em,
  to_char(c.cert_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') cert_em,
  ac.dispositivo, coalesce(ac.sessoes, 0) sessoes, coalesce(ac.seg_ativos, 0) seg_ativos,
  en.origem entrada_origem, en.via entrada_via,
  coalesce(f.n, 0) login_falhas,
  to_char(l.link_criado at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') link_criado,
  to_char(l.link_usado at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') link_usado,
  coalesce(ev.travei, 0) travei, coalesce(ev.pedidos_ajuda, 0) pedidos_ajuda,
  (a.curso is not null) tem_curso, (a.unidade is not null) tem_polo
from a
left join trilha t on t.aluno_id = a.id
left join cert c on c.aluno_id = a.id
left join acesso ac on ac.aluno_id = a.id
left join entrada en on en.aluno_id = a.id
left join falhas f on f.aluno_id = a.id
left join links l on l.aluno_id = a.id
left join ev on ev.aluno_id = a.id
where a.rgm <> '';
