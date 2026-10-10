"""Blogger publish tools used by the publishing desk.

OAuth client id and secret come from the environment. The token file is the
JSON with access_token, refresh_token, expiry, and an optional blog id cache.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from pydantic import BaseModel, Field

from runtime.text_similarity import best_similar_match
from runtime.tools import Tool

logger = logging.getLogger("office.blogger")

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
BLOGGER_API_BASE = "https://www.googleapis.com/blogger/v3"
BLOGGER_SCOPE = "https://www.googleapis.com/auth/blogger"

_publish_locks: Dict[str, asyncio.Lock] = {}
_publish_inflight: set[str] = set()


def token_path() -> Path:
    raw = os.getenv("BLOGGER_TOKEN_FILE", "").strip()
    if raw:
        return Path(raw)
    return Path.home() / ".the-office" / "blogger_credentials.json"


def prepare_blogger_body(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r"^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def markdown_to_html(text: str) -> str:
    if not text:
        return ""
    if re.search(r"<(p|div|h[1-6]|ul|ol|table|blockquote|article|img)[^>]*>", text, re.IGNORECASE):
        return re.sub(r"<hr\s*/?>", "", text, flags=re.IGNORECASE)
    text = prepare_blogger_body(text)
    import markdown

    html = markdown.markdown(text, extensions=["fenced_code", "tables"])
    return re.sub(r"<hr\s*/?>", "", html, flags=re.IGNORECASE)


def _normalize_title(title: str) -> str:
    return re.sub(r"\s+", " ", (title or "").strip().lower())


def _title_lock(title: str) -> asyncio.Lock:
    key = _normalize_title(title)
    lock = _publish_locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _publish_locks[key] = lock
    return lock


class BloggerClient:
    def __init__(self, path: Optional[Path] = None):
        self.token_path = path or token_path()
        self._blog_id_cache: Dict[str, str] = {}

    @property
    def client_id(self) -> str:
        return os.getenv("BLOGGER_CLIENT_ID", "").strip()

    @property
    def client_secret(self) -> str:
        return os.getenv("BLOGGER_CLIENT_SECRET", "").strip()

    @property
    def default_blog_url(self) -> str:
        return os.getenv("BLOGGER_BLOG_URL", "").strip()

    def _require_oauth_client(self) -> None:
        if not self.client_id or not self.client_secret:
            raise RuntimeError(
                "Set BLOGGER_CLIENT_ID and BLOGGER_CLIENT_SECRET. "
                "Create an OAuth desktop client in Google Cloud with the Blogger API enabled, "
                "then run: python backend/blogger_auth.py"
            )

    def load_tokens(self) -> Optional[Dict[str, Any]]:
        if not self.token_path.exists():
            return None
        try:
            data = json.loads(self.token_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("Could not read Blogger token %s: %s", self.token_path, exc)
            return None
        return data if isinstance(data, dict) else None

    def save_tokens(self, tokens: Dict[str, Any]) -> None:
        self.token_path.parent.mkdir(parents=True, exist_ok=True)
        existing = self.load_tokens() or {}
        if "refresh_token" in existing and "refresh_token" not in tokens:
            tokens["refresh_token"] = existing["refresh_token"]
        if "blog_id_cache" in existing and "blog_id_cache" not in tokens:
            tokens["blog_id_cache"] = existing["blog_id_cache"]
        self.token_path.write_text(json.dumps(tokens, indent=2), encoding="utf-8")

    def get_auth_url(self, redirect_uri: str = "http://localhost:8080/") -> str:
        self._require_oauth_client()
        params = {
            "client_id": self.client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": BLOGGER_SCOPE,
            "access_type": "offline",
            "prompt": "consent",
        }
        return f"{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}"

    def exchange_code(self, code: str, redirect_uri: str = "http://localhost:8080/") -> Dict[str, Any]:
        self._require_oauth_client()
        response = httpx.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            timeout=30.0,
        )
        if response.status_code != 200:
            raise RuntimeError(f"OAuth token exchange failed ({response.status_code}): {response.text}")
        tokens = response.json()
        tokens["obtained_at"] = time.time()
        self.save_tokens(tokens)
        return tokens

    async def get_valid_access_token(self) -> str:
        tokens = self.load_tokens()
        if not tokens:
            raise RuntimeError(
                "Blogger credentials not found. "
                "Run `python backend/blogger_auth.py` and point BLOGGER_TOKEN_FILE at the JSON it writes."
            )
        access_token = tokens.get("access_token")
        obtained_at = float(tokens.get("obtained_at") or 0)
        expires_in = float(tokens.get("expires_in") or 3600)
        if access_token and (time.time() - obtained_at) < (expires_in - 60):
            return str(access_token)

        refresh_token = tokens.get("refresh_token")
        if not refresh_token:
            raise RuntimeError("No Blogger refresh token. Run `python backend/blogger_auth.py` again.")
        self._require_oauth_client()
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                },
            )
        if res.status_code != 200:
            raise RuntimeError(f"Failed to refresh Blogger access token ({res.status_code}): {res.text}")
        new_tokens = res.json()
        new_tokens["obtained_at"] = time.time()
        new_tokens.setdefault("refresh_token", refresh_token)
        self.save_tokens(new_tokens)
        return str(new_tokens["access_token"])

    async def get_blog_id(self, blog_url: Optional[str] = None) -> str:
        raw = (blog_url or self.default_blog_url).strip()
        if not raw:
            raise RuntimeError("Set BLOGGER_BLOG_URL to the blog you want to publish to.")
        target = raw.rstrip("/") + "/"
        if target in self._blog_id_cache:
            return self._blog_id_cache[target]
        tokens = self.load_tokens() or {}
        cache = tokens.get("blog_id_cache") or {}
        if isinstance(cache, dict) and target in cache:
            self._blog_id_cache[target] = str(cache[target])
            return self._blog_id_cache[target]
        token = await self.get_valid_access_token()
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(
                f"{BLOGGER_API_BASE}/blogs/byurl",
                params={"url": target},
                headers={"Authorization": f"Bearer {token}"},
            )
        if res.status_code != 200:
            raise RuntimeError(f"Failed to resolve blog '{target}' ({res.status_code}): {res.text}")
        blog_id = str((res.json() or {}).get("id") or "")
        if not blog_id:
            raise RuntimeError(f"Blog id missing for {target}")
        self._blog_id_cache[target] = blog_id
        cache = dict(cache) if isinstance(cache, dict) else {}
        cache[target] = blog_id
        tokens["blog_id_cache"] = cache
        self.save_tokens(tokens)
        return blog_id

    async def get_blog_info(self, blog_url: Optional[str] = None) -> Dict[str, Any]:
        raw = (blog_url or self.default_blog_url).strip()
        if not raw:
            raise RuntimeError("Set BLOGGER_BLOG_URL to the blog you want to read.")
        target = raw.rstrip("/") + "/"
        token = await self.get_valid_access_token()
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(
                f"{BLOGGER_API_BASE}/blogs/byurl",
                params={"url": target},
                headers={"Authorization": f"Bearer {token}"},
            )
        if res.status_code != 200:
            raise RuntimeError(f"Failed to get blog info ({res.status_code}): {res.text}")
        return res.json()

    async def post_article(
        self,
        title: str,
        content: str,
        labels: Optional[List[str]] = None,
        is_draft: bool = False,
        blog_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        blog_id = await self.get_blog_id(blog_url)
        token = await self.get_valid_access_token()
        body: Dict[str, Any] = {
            "kind": "blogger#post",
            "title": title.strip(),
            "content": markdown_to_html(content),
        }
        clean = [item.strip() for item in (labels or []) if str(item).strip()]
        if clean:
            body["labels"] = clean
        async with httpx.AsyncClient(timeout=45.0) as client:
            res = await client.post(
                f"{BLOGGER_API_BASE}/blogs/{blog_id}/posts/",
                params={"isDraft": "true" if is_draft else "false"},
                json=body,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
            )
        if res.status_code not in (200, 201):
            raise RuntimeError(f"Failed to publish ({res.status_code}): {res.text}")
        return res.json()

    async def list_posts(
        self,
        blog_url: Optional[str] = None,
        max_results: int = 10,
    ) -> List[Dict[str, Any]]:
        blog_id = await self.get_blog_id(blog_url)
        token = await self.get_valid_access_token()
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(
                f"{BLOGGER_API_BASE}/blogs/{blog_id}/posts",
                params={"maxResults": min(max(int(max_results), 1), 50)},
                headers={"Authorization": f"Bearer {token}"},
            )
        if res.status_code != 200:
            raise RuntimeError(f"Failed to list posts ({res.status_code}): {res.text}")
        return list((res.json() or {}).get("items") or [])

    def start_local_auth_server(self, port: int = 8080, open_browser: bool = True) -> Dict[str, Any]:
        redirect_uri = f"http://localhost:{port}/"
        auth_url = self.get_auth_url(redirect_uri=redirect_uri)
        code_holder: Dict[str, Any] = {}

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                if "code" in query:
                    code_holder["code"] = query["code"][0]
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(
                        b"<html><body style='font-family:sans-serif;padding:2rem'>"
                        b"<h1>Blogger connected</h1><p>You can close this tab.</p></body></html>"
                    )
                else:
                    self.send_response(400)
                    self.end_headers()

            def log_message(self, fmt: str, *args: Any) -> None:
                return

        server = HTTPServer(("127.0.0.1", port), Handler)
        print(f"Open this URL if the browser does not:\n{auth_url}\n")
        if open_browser:
            webbrowser.open(auth_url)
        server.handle_request()
        code = code_holder.get("code")
        if not code:
            raise RuntimeError("OAuth callback did not include a code")
        return self.exchange_code(code, redirect_uri=redirect_uri)


default_blogger_client = BloggerClient()


class PostInput(BaseModel):
    title: str = Field(description="Post title")
    content: str = Field(description="Full Markdown body. The tool converts it to HTML.")
    labels: Optional[List[str]] = Field(default=None, description="Blogger labels")
    is_draft: bool = Field(default=False, description="Save as draft instead of publishing")
    blog_url: Optional[str] = Field(default=None, description="Override BLOGGER_BLOG_URL")
    force: bool = Field(default=False, description="Ignored unless BLOGGER_ALLOW_FORCE=true")


class ListPostsInput(BaseModel):
    max_results: int = Field(default=10, description="How many recent posts to list (1-50)")
    blog_url: Optional[str] = Field(default=None, description="Override BLOGGER_BLOG_URL")


class BlogInfoInput(BaseModel):
    blog_url: Optional[str] = Field(default=None, description="Override BLOGGER_BLOG_URL")


def blogger_tools(client: Optional[BloggerClient] = None) -> list[Tool]:
    blog = client or default_blogger_client

    async def post_to_blogger(
        title: str,
        content: str,
        labels: Optional[List[str]] = None,
        is_draft: bool = False,
        blog_url: Optional[str] = None,
        force: bool = False,
    ) -> str:
        allow_force = os.getenv("BLOGGER_ALLOW_FORCE", "").lower() in {"1", "true", "yes"}
        if force and not allow_force:
            force = False
        if isinstance(labels, str):
            labels = [part.strip() for part in labels.split(",") if part.strip()]
        try:
            async with _title_lock(title):
                key = _normalize_title(title)
                if key in _publish_inflight:
                    return (
                        "DUPLICATE: a publish for this exact title is already in flight. "
                        "Do NOT publish again — wait and reuse the existing URL."
                    )
                if not force:
                    existing = await blog.list_posts(blog_url=blog_url, max_results=50)
                    candidates = [
                        (str(post.get("id") or post.get("url") or idx), str(post.get("title") or ""))
                        for idx, post in enumerate(existing or [])
                    ]
                    match = best_similar_match(title, candidates, threshold=0.68)
                    if match:
                        dup = next(
                            (
                                post
                                for post in (existing or [])
                                if str(post.get("id") or "") == match[0]
                                or str(post.get("url") or "") == match[0]
                                or str(post.get("title") or "") == match[1]
                            ),
                            None,
                        )
                        url = (dup or {}).get("url") or ""
                        return (
                            f"DUPLICATE: a very similar post already exists on Blogger "
                            f"(title≈'{match[1]}', similarity {match[2]:.2f}). "
                            "Do NOT publish again. Reuse the existing post"
                            + (f": {url}" if url else ".")
                            + " Write your publicacao/*.md report with that URL and stop."
                        )
                _publish_inflight.add(key)
                try:
                    result = await blog.post_article(
                        title=title,
                        content=content,
                        labels=labels,
                        is_draft=is_draft,
                        blog_url=blog_url,
                    )
                finally:
                    _publish_inflight.discard(key)
            status = "DRAFT" if is_draft else "PUBLISHED"
            lines = [
                "Artigo postado com sucesso no Blogger!",
                f"- Status: {status}",
                f"- Título: {result.get('title', title)}",
                f"- ID: {result.get('id', 'N/A')}",
                f"- Data: {result.get('published', '')}",
            ]
            if result.get("url"):
                lines.append(f"- Link direto: {result['url']}")
            if labels:
                lines.append(f"- Marcadores: {', '.join(labels)}")
            return "\n".join(lines)
        except Exception as exc:
            logger.exception("post_to_blogger failed")
            return f"Erro ao postar no Blogger: {exc}"

    async def list_blogger_posts(max_results: int = 10, blog_url: Optional[str] = None) -> str:
        try:
            items = await blog.list_posts(blog_url=blog_url, max_results=max_results)
        except Exception as exc:
            return f"Erro ao listar posts do Blogger: {exc}"
        if not items:
            return "Nenhum post encontrado no blog."
        lines = [f"Encontrados {len(items)} posts recentes no Blogger:"]
        for idx, post in enumerate(items, 1):
            lines.append(f"{idx}. {post.get('title', 'Sem título')} ({str(post.get('published', ''))[:10]})")
            if post.get("url"):
                lines.append(f"   URL: {post['url']}")
            labels = ", ".join(post.get("labels") or [])
            if labels:
                lines.append(f"   Marcadores: {labels}")
        return "\n".join(lines)

    async def get_blog_info(blog_url: Optional[str] = None) -> str:
        try:
            info = await blog.get_blog_info(blog_url=blog_url)
        except Exception as exc:
            return f"Erro ao obter informações do blog: {exc}"
        posts = (info.get("posts") or {}).get("totalItems", 0)
        return (
            "Informações do Blog:\n"
            f"- Nome: {info.get('name', 'Blogger')}\n"
            f"- ID: {info.get('id', '')}\n"
            f"- URL: {info.get('url', '')}\n"
            f"- Total de Posts: {posts}\n"
            f"- Descrição: {info.get('description') or 'Nenhuma descrição fornecida.'}"
        )

    return [
        Tool(
            post_to_blogger,
            name="post_to_blogger",
            description=(
                "Publish one article on Blogger. Markdown is converted to HTML. "
                "Refuses when a similar title already exists. Never pass force=true. "
                "If DUPLICATE is returned, reuse that URL and stop."
            ),
            args_schema=PostInput,
        ),
        Tool(
            list_blogger_posts,
            name="list_blogger_posts",
            description="List recent Blogger posts (title, date, URL, labels).",
            args_schema=ListPostsInput,
        ),
        Tool(
            get_blog_info,
            name="get_blog_info",
            description="Read the blog name, URL, and post count.",
            args_schema=BlogInfoInput,
        ),
    ]
