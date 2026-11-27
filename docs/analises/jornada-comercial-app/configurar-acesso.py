#!/usr/bin/env python3
"""Cadastra um banco para leitura sem expor a senha.

Uso (no Terminal):  python3 docs/analises/jornada-comercial-app/configurar-acesso.py <servico>
  ex.: python3 .../configurar-acesso.py app_alunos_leitura

Pede a URL de conexão (postgres://usuario:senha@host:porta/banco) sem mostrá-la na tela,
grava host/porta/banco/usuário em ~/.pg_service.conf (sempre com default_transaction_read_only=on)
e a senha só em ~/.pgpass (permissão 600). Depois as consultas usam psql "service=<servico>".
"""
import getpass
import os
import re
import subprocess
import sys
from urllib.parse import unquote, urlparse

if len(sys.argv) != 2 or not re.fullmatch(r"[a-z0-9_]+", sys.argv[1]):
    sys.exit("uso: configurar-acesso.py <nome_do_servico>  (letras minúsculas, números e _)")
servico = sys.argv[1]

url = getpass.getpass(f"Cole a URL de conexão de '{servico}' (não aparece na tela) e tecle Enter: ").strip()
u = urlparse(url)
if u.scheme not in ("postgres", "postgresql") or not u.hostname or not u.username or u.password is None:
    sys.exit("URL inválida: esperado postgres://usuario:senha@host:porta/banco")
host, porta = u.hostname, str(u.port or 5432)
banco = (u.path or "/").lstrip("/") or "postgres"
usuario, senha = unquote(u.username), unquote(u.password)
ssl = re.search(r"sslmode=([a-z-]+)", u.query or "")
sslmode = ssl.group(1) if ssl else "prefer"

def esc(v):
    return v.replace("\\", "\\\\").replace(":", "\\:")

# ~/.pgpass: troca a linha do mesmo host/porta/banco/usuário
pgpass = os.path.expanduser("~/.pgpass")
chave = f"{esc(host)}:{porta}:{esc(banco)}:{esc(usuario)}:"
linhas = []
if os.path.exists(pgpass):
    with open(pgpass) as f:
        linhas = [l for l in f.read().splitlines() if l and not l.startswith(chave)]
linhas.append(chave + esc(senha))
fd = os.open(pgpass, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    f.write("\n".join(linhas) + "\n")
os.chmod(pgpass, 0o600)

# ~/.pg_service.conf: troca a seção do serviço
conf = os.path.expanduser("~/.pg_service.conf")
texto = open(conf).read() if os.path.exists(conf) else ""
texto = re.sub(rf"(?ms)^\[{re.escape(servico)}\]\n.*?(?=^\[|\Z)", "", texto).rstrip()
secao = (
    f"[{servico}]\nhost={host}\nport={porta}\ndbname={banco}\nuser={usuario}\n"
    f"sslmode={sslmode}\noptions=-c default_transaction_read_only=on -c statement_timeout=120000\n"
)
with open(conf, "w") as f:
    f.write((texto + "\n\n" if texto else "") + secao)

r = subprocess.run(["psql", f"service={servico}", "-XAtc", "select current_user || ' em ' || current_database()"],
                   capture_output=True, text=True)
if r.returncode == 0:
    print(f"OK: {servico} conectado ({r.stdout.strip()}), sessão só leitura.")
else:
    print(f"Gravado, mas a conexão falhou: {r.stderr.strip().splitlines()[-1] if r.stderr.strip() else 'erro'}")
