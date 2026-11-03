'use strict';

// Estatísticas do admin contam só as contas criadas a partir de uma data (Configurações > faixas, contar_desde).
// Não apaga nada: quem é mais antigo continua podendo entrar e aparece em "Acessos dos alunos".

const acompanhamento = require('./acompanhamento');
const painel = require('./painel');

async function contarDesde(pool) {
  try {
    return (await acompanhamento.lerConfig(pool)).faixas.contar_desde;
  } catch (err) {
    if (err.code === '42P01') return painel.faixasPadrao().contar_desde; // config ainda não existe
    throw err;
  }
}

// Subconsultas para usar com a data no parâmetro $n (NULL = todas as contas).
const contaNoCorte = (n) => `($${n}::date IS NULL OR created_at >= (($${n}::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'))`;
const idsNoCorte = (n) => `SELECT id FROM csu_alunos WHERE ${contaNoCorte(n)}`;
const rgmsNoCorte = (n) => `SELECT rgm FROM csu_alunos WHERE ${contaNoCorte(n)}`;

module.exports = { contarDesde, idsNoCorte, rgmsNoCorte };
