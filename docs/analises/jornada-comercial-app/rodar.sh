#!/usr/bin/env bash
# Roda a análise da jornada comercial → app de ponta a ponta.
# Uso: docs/analises/jornada-comercial-app/rodar.sh [venda_de] [venda_ate] [pasta_saida]
#   venda_de / venda_ate: coorte da parte do app (dias de venda, ate exclusivo). Padrão: 2026-10-29 e hoje.
#   pasta_saida: onde ficam os CSV com hash do RGM (padrão: pasta temporária; nunca dentro do repositório).
# Precisa de: serviços crm_leitura e app_alunos_leitura em ~/.pg_service.conf (ver configurar-acesso.py)
# e um Postgres local (localhost) para juntar as duas extrações.
set -euo pipefail
cd "$(dirname "$0")"

DE="${1:-2026-10-29}"
ATE="${2:-$(date +%F)}"
OUT="${3:-$(mktemp -d)}"
SAL="${SAL:-jornada2026}"               # mesmo texto nas duas extrações, senão o hash não casa
EXTRAIR_DESDE="${EXTRAIR_DESDE:-2026-10-01}"
LOCAL_DB="${LOCAL_DB:-jornada_tmp}"
export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=900000'

echo "1/4 CRM: vendas de $EXTRAIR_DESDE até $ATE"
psql "service=crm_leitura" -X -q --csv -v desde="$EXTRAIR_DESDE" -v ate="$ATE" -v sal="$SAL" -f sql/01_crm_vendas.sql > "$OUT/crm_vendas.csv"

echo "2/4 App: contas"
psql "service=app_alunos_leitura" -X -q --csv -v desde=2020-01-01 -v sal="$SAL" -f sql/02_app_alunos.sql > "$OUT/app_alunos.csv"

echo "3/4 CRM: funil de leads (janela que termina 7 dias antes de $ATE)"
LEADS_ATE=$(date -j -v-7d -f %F "$ATE" +%F 2>/dev/null || date -d "$ATE -7 days" +%F)
psql "service=crm_leitura" -X -P pager=off -v desde="$EXTRAIR_DESDE" -v ate="$LEADS_ATE" -f sql/03_crm_leads.sql > "$OUT/03_leads.txt"

echo "4/4 Junta localmente ($LOCAL_DB) e calcula"
unset PGOPTIONS
createdb -h localhost "$LOCAL_DB" 2>/dev/null || true
for t in crm_vendas app_alunos; do
  cols=$(head -1 "$OUT/$t.csv" | sed 's/,/ text,/g; s/$/ text/')
  psql -h localhost -d "$LOCAL_DB" -Xq -c "drop table if exists $t cascade; create table $t ($cols);" -c "\\copy $t from '$OUT/$t.csv' csv header"
done
psql -h localhost -d "$LOCAL_DB" -X -v de="$DE" -v ate="$ATE" -f sql/04_jornada_local.sql > "$OUT/04_jornada.txt"

echo "Pronto. Resultados agregados: $OUT/03_leads.txt e $OUT/04_jornada.txt"
echo "Os CSV em $OUT têm uma linha por aluno (RGM em hash): apague quando terminar, e o banco local com: dropdb -h localhost $LOCAL_DB"
