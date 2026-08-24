# AGENT.md — Registro de Decisões

### 2026-08-19 - Finalização do Portal do Aluno (Certificado da Aula Inaugural)

**Decisão**
- Stack: frontend vanilla JS organizado em módulos (`public/js/*`) + backend Node/Express mínimo (`server/index.js`). Nenhum framework novo introduzido (protótipo era HTML único com CDNs).
- Certificado: geração client-side com `pdf-lib` sobre o template oficial `public/assets/certificado-template.pdf`. Os dados variáveis do aluno original são **removidos do content stream** (seções `q...Q` identificadas pelas coordenadas) e redesenhados com Montserrat-Regular embutida — em vez de cobrir com retângulos brancos (que manteria os dados antigos extraíveis no arquivo).
- Autenticação: `POST /api/auth/login` com usuário de teste via `.env` → token opaco em memória (Bearer). Páginas internas protegidas no frontend; emissão exige token no backend.
- Registro de emissão: append em `data/emissions.jsonl`; `certificate_id` gerado no backend (`CSU-AAAA-XXXXXXXX`); `created_at` oficial do servidor em `America/Sao_Paulo`.

**Contexto**
- Protótipo do Google AI Studio tinha login fake, backend mockado e certificado redesenhado em HTML/html2pdf — tudo removido conforme especificação.

**Alternativas descartadas**
- React/Vite: spec proíbe framework novo sem necessidade.
- Cobrir texto antigo com retângulo branco: deixaria PII do aluno original extraível no PDF.
- Geração do PDF no backend: spec permite frontend; client-side reduz carga e simplifica preview (Blob URL).

**Impacto**
- Produção precisa: substituir usuário de teste por IdP/banco acadêmico, persistir tokens, e migrar o registro JSONL para banco. Pontos de integração isolados em `server/index.js` e `public/js/api.js` (URL via `CERTIFICATE_API_URL`).

### 2026-08-24 - Avisos e notificações do aluno

**Decisão**
- Tabelas novas `csu_avisos` e `csu_aviso_leituras` via `CREATE TABLE IF NOT EXISTS` (sem DROP). Público `todos|polo|curso`; polo/curso do aluno = último `csu_certificados`. Recorrência mensal visível nos 7 dias até `dia_recorrente`, com data em `America/Sao_Paulo`.
- APIs autenticadas: `GET /api/avisos`, `GET /api/avisos/nao-lidas`, `POST /api/avisos/:id/lida`. Sem painel admin; seeds em `sql/seed_avisos.sql`.
- UI: sino + badge, card no dashboard e tela `avisos-page`. Certificado, login e tabelas antigas intactos.

**Contexto**
- Primeira fatia da área do aluno após o certificado. Curso/polo ainda não existem em `csu_alunos`.

**Alternativas descartadas**
- Colunas `curso`/`unidade` em `csu_alunos` nesta etapa (evita migração de dados agora).
- Painel admin de CRUD (pedido: testar por INSERT SQL).
- `CURRENT_DATE` no Postgres (UTC no servidor distorce a janela recorrente).

**Impacto**
- Aluno sem certificado só vê avisos `publico='todos'`. Variáveis `MATRICULADOS_*` ficam no `.env` para etapa futura; não entram neste fluxo.

### 2026-08-24 - Tutoriais, atendimento, indicações e /admin

**Decisão**
- Tutoriais em `csu_tutoriais`: só URL do YouTube; embed gerado no backend (`youtube-nocookie`) e iframe só no clique.
- Atendimento usa último polo de `csu_certificados`, com WhatsApp por polo em `csu_contatos_polo` e fallback `WHATSAPP_*_PADRAO`.
- Indicações em `csu_indicacoes`: grava no banco primeiro; `INDICACAO_WEBHOOK_URL` é opcional e nunca vai ao frontend.
- Admin em `/admin` com tabelas `csu_admins` / `csu_admin_sessoes` — não reutiliza login do aluno.

**Contexto**
- Continuação da área do aluno após avisos, sem alterar certificado/auth/notificações.

**Alternativas descartadas**
- HTML/embed livre nos tutoriais (risco XSS).
- Autorizar admin com a mesma sessão do aluno.
- CRM completo de indicações.

**Impacto**
- EasyPanel: novas env `ADMIN_*`, `WHATSAPP_*_PADRAO`, `INDICACAO_WEBHOOK_URL`. Porta do container continua 80.
