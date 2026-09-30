"""`aa-workbench` — the console launcher for the Workbench.

Commands:
  aa-workbench            Build the UI if needed, then serve UI + API on one port.
  aa-workbench serve      Same, with options (--port/--host/--source/--open).
  aa-workbench dev        Run the frontend + backend with hot reload (developers).
  aa-workbench build      Build the frontend for production.
  aa-workbench check      Is everything the Workbench runs installed? (pre-flight)

The `serve` path is the deployment story: a single process on a single port,
no Node, no second terminal, no proxy, no CORS. The compiled UI is served by
FastAPI next to `/api`, so the browser only ever talks to one origin.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import threading
import time
import webbrowser

from . import __version__, _paths


def _fail(message: str) -> None:
    print(f"aa-workbench: {message}", file=sys.stderr)
    raise SystemExit(1)


def _npm() -> str:
    npm = shutil.which("npm")
    if npm is None:
        _fail(
            "`npm` not found. Install Node.js 18+ (https://nodejs.org) "
            "to build the UI."
        )
    return npm  # type: ignore[return-value]


def _build_frontend() -> None:
    """Install deps (first run) and build the UI with the API enabled."""
    fe = _paths.frontend_dir()
    if fe is None:
        _fail(
            "frontend/ source not found. Building needs the repo checkout; "
            "a wheel with a bundled UI can be served but not rebuilt."
        )
    npm = _npm()
    # The production build must talk to the API (not the mock), and it calls the
    # same origin it is served from, so no base URL is needed.
    env = {**os.environ, "VITE_AASI_USE_API": "true"}

    if not (fe / "node_modules").is_dir():  # type: ignore[union-attr]
        print("Installing frontend dependencies (first run, one-time)…")
        subprocess.run([npm, "install"], cwd=fe, check=True)

    print("Building the Workbench UI…")
    subprocess.run([npm, "run", "build"], cwd=fe, check=True, env=env)


def _ui_is_stale(dist) -> bool:  # noqa: ANN001 - a Path
    """True when the UI sources are newer than the build about to be served.

    `serve` used to build only when there was no build at all, so updating the
    checkout (a pull, or unpacking a new copy over the old one) kept serving
    the old UI with nothing to say so. Only a source checkout's own dist/ is
    compared; a bundled or overridden build has no sources here to be newer.
    """
    fe = _paths.frontend_dir()
    if fe is None or dist.resolve() != (fe / "dist").resolve():
        return False
    built = (dist / "index.html").stat().st_mtime
    for base in (fe / "src", fe / "index.html", fe / "package.json"):
        candidates = base.rglob("*") if base.is_dir() else [base]
        for path in candidates:
            try:
                if path.is_file() and path.stat().st_mtime > built:
                    return True
            except OSError:
                continue
    return False


def cmd_check(_args: argparse.Namespace) -> None:
    """The pre-flight: the console tools, who you are, where products go."""
    from .api.baseline import get_config

    config = get_config()
    width = max(len(t.name) for t in config.tools)
    print("\n  AA-SI Workbench — pre-flight\n")
    for tool in config.tools:
        mark = "ok " if tool.present else "MISSING"
        print(f"  {tool.name:<{width}}  {mark}")
    try:
        from importlib.metadata import version

        print(f"\n  aalibrary        {version('aalibrary')}")
    except Exception:  # noqa: BLE001 - not installed is reported above
        print("\n  aalibrary        not installed")
    who = config.user or "(unknown: products go under unknown-user/)"
    print(f"  signed in as     {who}")
    print(f"  products go to   gs://{config.bucket}/{config.prefixTemplate}")
    print(f"  working folders  {config.runRoot}")
    dist = _paths.frontend_dist_dir()
    if dist is None:
        ui = "not built (serve will build it)"
    elif _ui_is_stale(dist):
        ui = "out of date (serve will rebuild it)"
    else:
        ui = f"built ({dist})"
    print(f"  UI               {ui}")
    if config.problems:
        print("\n  Problems:")
        for problem in config.problems:
            print(f"   - {problem}")
        raise SystemExit(1)
    print("\n  Ready.\n")


def cmd_build(_args: argparse.Namespace) -> None:
    _build_frontend()
    print(f"UI built at: {_paths.frontend_dist_dir()}")


def cmd_serve(args: argparse.Namespace) -> None:
    os.environ["AASI_NCEI_SOURCE"] = args.source
    # Published so the environment updater can refuse to rewrite this venv
    # when the server is reachable from off-host (see api/environment.py).
    os.environ["AASI_BIND_HOST"] = args.host

    dist = _paths.frontend_dist_dir()
    if dist is None:
        if args.no_build:
            _fail(
                "UI not built and --no-build was set. "
                "Run `aa-workbench build` first."
            )
        print("UI not built yet — building it now…")
        _build_frontend()
        dist = _paths.frontend_dist_dir()
        if dist is None:
            _fail("Build finished but produced no dist/. See the errors above.")
    elif not args.no_build and _ui_is_stale(dist):
        print("The UI sources are newer than the built UI — rebuilding…")
        try:
            _build_frontend()
        except (SystemExit, subprocess.CalledProcessError, OSError) as exc:
            # An old UI is better than no server: say so and carry on.
            print(
                f"aa-workbench: the rebuild failed ({exc}); serving the existing "
                "build, which may be out of date. `aa-workbench build` retries.",
                file=sys.stderr,
            )

    url = f"http://{args.host}:{args.port}"
    banner = (
        f"\n  AA-SI Workbench\n"
        f"  → {url}\n"
        f"  NCEI source: {args.source}   (Ctrl+C to stop)\n"
    )
    print(banner)

    if args.open_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()

    import uvicorn

    uvicorn.run(
        "aa_si_workbench.api.main:app",
        host=args.host,
        port=args.port,
        reload=False,
        log_level="info",
    )


def cmd_dev(args: argparse.Namespace) -> None:
    fe = _paths.frontend_dir()
    if fe is None:
        _fail("dev mode needs the repo checkout (frontend/ not found).")
    npm = _npm()

    if not (fe / "node_modules").is_dir():  # type: ignore[union-attr]
        print("Installing frontend dependencies (first run, one-time)…")
        subprocess.run([npm, "install"], cwd=fe, check=True)

    api_env = {
        **os.environ,
        "AASI_NCEI_SOURCE": args.source,
        "AASI_BIND_HOST": "127.0.0.1",
    }
    web_env = {
        **os.environ,
        "VITE_AASI_USE_API": "true",
        "VITE_AASI_API_PROXY": f"http://localhost:{args.api_port}",
    }

    print(
        f"\n  AA-SI Workbench (dev)\n"
        f"  → open http://localhost:{args.web_port}\n"
        f"  API on :{args.api_port}   NCEI source: {args.source}   (Ctrl+C to stop)\n"
    )

    api = subprocess.Popen(
        [
            sys.executable, "-m", "uvicorn",
            "aa_si_workbench.api.main:app",
            "--reload", "--port", str(args.api_port),
        ],
        env=api_env,
    )
    web = subprocess.Popen(
        [npm, "run", "dev", "--", "--port", str(args.web_port)],
        cwd=fe,
        env=web_env,
    )

    try:
        while api.poll() is None and web.poll() is None:
            time.sleep(0.4)
    except KeyboardInterrupt:
        pass
    finally:
        for proc in (web, api):
            if proc.poll() is None:
                proc.terminate()
        for proc in (web, api):
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="aa-workbench",
        description="Launch the AA-SI Workbench (UI + API) from one command.",
    )
    parser.add_argument(
        "--version", action="version", version=f"aa-workbench {__version__}"
    )
    # Bare `aa-workbench` == `serve` with defaults.
    parser.set_defaults(
        func=cmd_serve,
        host="127.0.0.1",
        port=8000,
        source="s3",
        open_browser=False,
        no_build=False,
    )

    sub = parser.add_subparsers()

    p_serve = sub.add_parser(
        "serve", help="Build the UI if needed, then serve UI + API on one port."
    )
    p_serve.add_argument(
        "--host", default="127.0.0.1", help="Bind host (default 127.0.0.1)."
    )
    p_serve.add_argument(
        "--port", type=int, default=8000, help="Bind port (default 8000)."
    )
    p_serve.add_argument(
        "--source", choices=["s3", "cache"], default="s3",
        help="NCEI backend: s3 (no creds, default) or cache (BigQuery).",
    )
    p_serve.add_argument(
        "--open", dest="open_browser", action="store_true", help="Open a browser."
    )
    p_serve.add_argument(
        "--no-build", action="store_true", help="Fail instead of building the UI."
    )
    p_serve.set_defaults(func=cmd_serve)

    p_dev = sub.add_parser(
        "dev", help="Run frontend + backend with hot reload (developers)."
    )
    p_dev.add_argument(
        "--web-port", type=int, default=5173, help="Vite dev port (default 5173)."
    )
    p_dev.add_argument(
        "--api-port", type=int, default=8000, help="API port (default 8000)."
    )
    p_dev.add_argument(
        "--source", choices=["s3", "cache"], default="s3",
        help="NCEI backend: s3 (default) or cache.",
    )
    p_dev.set_defaults(func=cmd_dev)

    p_build = sub.add_parser("build", help="Build the frontend for production.")
    p_build.set_defaults(func=cmd_build)

    p_check = sub.add_parser(
        "check",
        help="Pre-flight: are the console tools installed? Where do products go?",
    )
    p_check.set_defaults(func=cmd_check)

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
