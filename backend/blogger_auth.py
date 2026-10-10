"""One-time Google OAuth for the publishing desk.

Usage (from the repo root, with the virtualenv active):

    python backend/blogger_auth.py

Writes the token JSON to BLOGGER_TOKEN_FILE, or to ~/.the-office/blogger_credentials.json.
Copy that file to secrets/blogger_credentials.json before starting Docker.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from runtime.blogger import BloggerClient, token_path


def main() -> None:
    os.environ.setdefault("BLOGGER_TOKEN_FILE", str(token_path()))
    client = BloggerClient()
    print(f"Token file: {client.token_path}")
    tokens = client.start_local_auth_server(port=int(os.getenv("BLOGGER_AUTH_PORT", "8080")))
    print(f"Saved Blogger credentials ({', '.join(sorted(tokens))}).")


if __name__ == "__main__":
    main()
