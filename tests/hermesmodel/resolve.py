import os, sys, json
sys.path.insert(0, "/home/claude/hermes-src")
from hermes_cli.env_loader import load_hermes_dotenv
try: load_hermes_dotenv()
except TypeError: load_hermes_dotenv(None)
from hermes_cli.runtime_provider import resolve_runtime_provider
r = resolve_runtime_provider()
print(json.dumps({k: (v if k != "api_key" else (str(v)[:6] + "…" if v else v)) for k, v in dict(r).items() if k in ("provider","base_url","api_key","model","api_mode","source")}))
