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
