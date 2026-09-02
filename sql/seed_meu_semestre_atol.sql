-- Mensalidade de teste para o aluno "Atol Lada rego", se ele existir em csu_alunos.
-- Opcional. Não é executado automaticamente.
--   psql ... -f sql/seed_meu_semestre_atol.sql
-- Referência 09/2026, status aberto, vencimento 10/09/2026.

INSERT INTO csu_semestre_mensalidades (aluno_id, referencia, status, vencimento)
SELECT a.id, '09/2026', 'aberto', DATE '2026-09-10'
FROM csu_alunos a
WHERE lower(regexp_replace(a.nome, '\s+', ' ', 'g')) = 'atol lada rego'
ON CONFLICT (aluno_id, referencia) DO UPDATE
SET status = EXCLUDED.status,
    vencimento = EXCLUDED.vencimento;
