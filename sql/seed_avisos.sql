-- Dados de teste para avisos. Não dropa tabelas existentes.
-- Polo/curso do aluno vêm da última linha em csu_certificados.
-- Recorrência: visível nos 7 dias até o dia_recorrente (fuso America/Sao_Paulo).
-- Em 24/08, o aviso do dia 25 aparece; o do dia 10 não.

DELETE FROM csu_avisos WHERE titulo LIKE '[TESTE]%';

INSERT INTO csu_avisos
  (titulo, descricao, categoria, prioridade, data_inicio, data_fim, ativo, publico, polo, curso, recorrente, dia_recorrente)
VALUES
  (
    '[TESTE] Bem-vindo ao portal',
    'Este recado vale para todos os alunos. Use-o para conferir o sino e o badge de não lidas.',
    'Geral', 'media', '2026-01-01', '2026-12-31', TRUE, 'todos', NULL, NULL, FALSE, NULL
  ),
  (
    '[TESTE] Mensalidade vence dia 25',
    'Lembrete recorrente: o vencimento da mensalidade é todo dia 25. Visível de 18 a 25.',
    'Financeiro', 'alta', '2026-01-01', '2026-12-31', TRUE, 'todos', NULL, NULL, TRUE, 25
  ),
  (
    '[TESTE] Calendário de provas',
    'Consulte o calendário acadêmico e organize seus estudos com antecedência.',
    'Provas', 'media', '2026-01-01', '2026-12-31', TRUE, 'todos', NULL, NULL, FALSE, NULL
  ),
  (
    '[TESTE] Atividade complementar',
    'Há uma atividade extra disponível nesta semana. Acesse o AVA para enviar.',
    'Atividades', 'baixa', '2026-01-01', '2026-12-31', TRUE, 'todos', NULL, NULL, FALSE, NULL
  ),
  (
    '[TESTE] Recado do polo Barra Funda',
    'Só aparece para quem emitiu certificado com unidade Barra Funda.',
    'Acadêmico', 'media', '2026-01-01', '2026-12-31', TRUE, 'polo', 'Barra Funda', NULL, FALSE, NULL
  ),
  (
    '[TESTE] Recado do curso Administração',
    'Só aparece para quem emitiu certificado com curso Administração.',
    'Acadêmico', 'baixa', '2026-01-01', '2026-12-31', TRUE, 'curso', NULL, 'Administração', FALSE, NULL
  ),
  (
    '[TESTE] Vencimento dia 10 (fora da janela em 24/08)',
    'Recorrente no dia 10. Em 24/08 não deve aparecer (janela 3–10).',
    'Financeiro', 'alta', '2026-01-01', '2026-12-31', TRUE, 'todos', NULL, NULL, TRUE, 10
  ),
  (
    '[TESTE] Inativo — não deve aparecer',
    'Aviso desligado. Se aparecer, o filtro de ativo está errado.',
    'Geral', 'alta', '2026-01-01', '2026-12-31', FALSE, 'todos', NULL, NULL, FALSE, NULL
  ),
  (
    '[TESTE] Expirado — não deve aparecer',
    'Data fim no passado. Se aparecer, o filtro de período está errado.',
    'Geral', 'alta', '2026-01-01', '2026-01-31', TRUE, 'todos', NULL, NULL, FALSE, NULL
  ),
  (
    '[TESTE] Futuro — não deve aparecer',
    'Ainda não começou. Se aparecer, o filtro de data_inicio está errado.',
    'Geral', 'alta', '2027-01-01', '2027-12-31', TRUE, 'todos', NULL, NULL, FALSE, NULL
  );
