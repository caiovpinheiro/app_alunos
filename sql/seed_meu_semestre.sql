-- Dados acadêmicos de Meu Semestre (Administração 2026/2).
-- NÃO é executado automaticamente pelo app. Rode manualmente no Postgres do portal:
--   psql "host=... port=... dbname=... user=..." -f sql/seed_meu_semestre.sql
-- Sem DROP. Idempotente via ON CONFLICT.

INSERT INTO csu_semestre_planos (curso, periodo, titulo, ativo)
VALUES ('Administração', '2026/2', 'Meu Semestre 2026/2', TRUE)
ON CONFLICT (curso, periodo) DO UPDATE
SET titulo = EXCLUDED.titulo,
    ativo = TRUE;

INSERT INTO csu_semestre_itens (
  plano_id, tipo, titulo, descricao, mes,
  data_inicio, data_fim, prova_inicio, prova_fim,
  prazo, prazo_preferencial, tutorial_categoria, tutorial_hint, destaque, ordem
)
SELECT p.id, v.tipo, v.titulo, v.descricao, v.mes,
       v.data_inicio::date, v.data_fim::date, v.prova_inicio::date, v.prova_fim::date,
       v.prazo::date, v.prazo_preferencial::date, v.tutorial_categoria, v.tutorial_hint, v.destaque, v.ordem
FROM csu_semestre_planos p
CROSS JOIN (VALUES
  (
    'disciplina',
    'Administração Financeira e Orçamentária',
    'Disciplina mensal de setembro.',
    'SET',
    '2026-09-01', '2026-09-30', '2026-10-02', '2026-10-05',
    NULL, NULL, 'Provas', 'Como realizar provas', FALSE, 10
  ),
  (
    'disciplina',
    'Contabilidade e Finanças',
    'Disciplina mensal de outubro.',
    'OUT',
    '2026-10-01', '2026-10-31', '2026-11-06', '2026-11-09',
    NULL, NULL, 'Provas', 'Como realizar provas', FALSE, 20
  ),
  (
    'disciplina',
    'Administração de Recursos Humanos',
    'Disciplina mensal de novembro.',
    'NOV',
    '2026-11-01', '2026-11-30', '2026-11-27', '2026-11-30',
    NULL, NULL, 'Provas', 'Como realizar provas', FALSE, 30
  ),
  (
    'atividade',
    'Ambientação Digital',
    'Disponível até 18/12. Finalize preferencialmente até 01/12.',
    NULL,
    NULL, NULL, NULL, NULL,
    '2026-12-18', '2026-12-01', 'Primeiros passos', 'Como acessar e concluir', TRUE, 40
  ),
  (
    'atividade',
    'Plano de Acompanhamento de Carreira em Administração I',
    'Disponível até 18/12. Finalize preferencialmente até 01/12.',
    NULL,
    NULL, NULL, NULL, NULL,
    '2026-12-18', '2026-12-01', 'Atividades', 'Entenda cada etapa', TRUE, 50
  ),
  (
    'atividade',
    'Projeto Multidisciplinar em Administração I',
    'Disponível até 18/12.',
    NULL,
    NULL, NULL, NULL, NULL,
    '2026-12-18', NULL, 'Atividades', 'Veja como desenvolver', TRUE, 60
  ),
  (
    'atividade',
    'Atividade de Extensão',
    'Disponível até 18/12. Finalize preferencialmente até 17/11.',
    NULL,
    NULL, NULL, NULL, NULL,
    '2026-12-18', '2026-11-17', 'Atividades', 'Passo a passo completo', TRUE, 70
  ),
  (
    'avaliacao_integrada',
    'Avaliação Integrada de Competências em Administração I',
    'Avaliação separada das disciplinas mensais. Prazo até 18/12.',
    NULL,
    NULL, NULL, NULL, NULL,
    '2026-12-18', NULL, 'Provas', 'Como realizar provas', TRUE, 80
  )
) AS v (
  tipo, titulo, descricao, mes,
  data_inicio, data_fim, prova_inicio, prova_fim,
  prazo, prazo_preferencial, tutorial_categoria, tutorial_hint, destaque, ordem
)
WHERE p.curso = 'Administração' AND p.periodo = '2026/2'
ON CONFLICT (plano_id, tipo, titulo) DO UPDATE
SET descricao = EXCLUDED.descricao,
    mes = EXCLUDED.mes,
    data_inicio = EXCLUDED.data_inicio,
    data_fim = EXCLUDED.data_fim,
    prova_inicio = EXCLUDED.prova_inicio,
    prova_fim = EXCLUDED.prova_fim,
    prazo = EXCLUDED.prazo,
    prazo_preferencial = EXCLUDED.prazo_preferencial,
    tutorial_categoria = EXCLUDED.tutorial_categoria,
    tutorial_hint = EXCLUDED.tutorial_hint,
    destaque = EXCLUDED.destaque,
    ordem = EXCLUDED.ordem;

INSERT INTO csu_semestre_eventos (
  plano_id, titulo, subtitulo, data_inicio, data_fim, tipo, ordem
)
SELECT p.id, v.titulo, v.subtitulo, v.data_inicio::date, v.data_fim::date, v.tipo, v.ordem
FROM csu_semestre_planos p
CROSS JOIN (VALUES
  ('Fim da disciplina do mês', 'Administração Financeira e Orçamentária', '2026-09-30', '2026-09-30', 'disciplina', 10),
  ('Início do período de prova', 'Administração Financeira e Orçamentária · disponível até 05/10', '2026-10-02', '2026-10-05', 'prova', 20),
  ('Fim da disciplina do mês', 'Contabilidade e Finanças', '2026-10-31', '2026-10-31', 'disciplina', 30),
  ('Início do período de prova', 'Contabilidade e Finanças · disponível até 09/11', '2026-11-06', '2026-11-09', 'prova', 40),
  ('Prazo preferencial', 'Atividade de Extensão', '2026-11-17', '2026-11-17', 'prazo', 50),
  ('Início do período de prova', 'Administração de Recursos Humanos · disponível até 30/11', '2026-11-27', '2026-11-30', 'prova', 60),
  ('Fim da disciplina do mês', 'Administração de Recursos Humanos', '2026-11-30', '2026-11-30', 'disciplina', 70),
  ('Prazo preferencial', 'Ambientação Digital e Plano de Carreira', '2026-12-01', '2026-12-01', 'prazo', 80),
  ('Recuperação', '11 e 12/12', '2026-12-11', '2026-12-12', 'recuperacao', 90),
  ('Encerramento das disciplinas', 'Prazo final das atividades obrigatórias', '2026-12-18', '2026-12-18', 'encerramento', 100),
  ('Encerramento do semestre', 'Último dia letivo do período', '2026-12-19', '2026-12-19', 'encerramento', 110),
  ('Divulgação final', 'Resultados do semestre', '2026-12-21', '2026-12-21', 'divulgacao', 120)
) AS v (titulo, subtitulo, data_inicio, data_fim, tipo, ordem)
WHERE p.curso = 'Administração' AND p.periodo = '2026/2'
ON CONFLICT (plano_id, titulo, data_inicio) DO UPDATE
SET subtitulo = EXCLUDED.subtitulo,
    data_fim = EXCLUDED.data_fim,
    tipo = EXCLUDED.tipo,
    ordem = EXCLUDED.ordem;
