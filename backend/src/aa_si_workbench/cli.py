"""`aa-workbench` — the console launcher for the Workbench.

Commands:
  aa-workbench            Build the UI if needed, then serve UI + API on one port.
  aa-workbench serve      Same, with options (--port/--host/--source/--open).
  aa-workbench dev        Run the frontend + backend with hot reload (developers).
  aa-workbench build      Build the frontend for production.
  aa-workbench check      Is everything the Workbench runs installed? (pre-flight)
  aa-workbench project    The GCP projects and buckets you can use; choose one.

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
    if config.bucket:
        how = {
            "chosen": "chosen in the Workbench",
            "discovered": "the only bucket you can write to",
            "environment": "from the environment",
        }.get(config.bucketSource, config.bucketSource)
        print(f"  GCP project      {config.project or '(unknown)'} ({how})")
        print(f"  products go to   gs://{config.bucket}/{config.prefixTemplate}")
    else:
        print("  products go to   (no project and bucket chosen: run")
        print("                   `aa-workbench project`, or choose in the Workbench)")
    print(f"  working folders  {config.runRoot}")
    _print_working_space(config.runRoot)
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


def _print_working_space(root: str) -> None:
    """Free space under the working folder, its file system, and the memory mode."""
    from pathlib import Path

    from .api import jobs, workspace

    path = Path(root).expanduser()
    free, total = workspace.disk_space(path)
    mount = workspace.mount_of(path)
    kind = f", {mount.fstype}" if mount else ""
    space = f"{workspace.human(free)} free of {workspace.human(total)}{kind}"
    print(f"                   {space}")
    problem = workspace.folder_problem(path, mount)
    if problem:
        print(f"                   ! {problem}")
    try:
        streaming = workspace.tools_stream(jobs.resolve_tool("aa-combine"))
    except Exception:  # noqa: BLE001 - a missing tool is reported above
        streaming = None
    mode = {
        True: "streamed (about 1 GB for any length of range)",
        False: "whole range in memory: update aalibrary for the memory fix",
        None: "unknown (could not ask the installed aalibrary)",
    }[streaming]
    print(f"  memory           {mode}")
    print(f"  this machine     {workspace.human(workspace.memory_total())} of memory")


def cmd_project(args: argparse.Namespace) -> None:
    """List the projects and buckets you can use; choose or forget one."""
    from .api import gcp

    if args.forget:
        context = gcp.forget()
        print(f"Forgotten. In force now: {_context_line(context)}")
        return
    if args.project or args.bucket:
        try:
            bucket = args.bucket or f"{args.project}-data"
            context = gcp.choose(args.project or "", bucket)
        except Exception as exc:  # noqa: BLE001 - HTTPException carries .detail
            _fail(str(getattr(exc, "detail", exc)))
        print(f"Chosen: {_context_line(context)}")
        return

    print("\n  Looking at what you can use (Google credentials of this machine)...\n")
    found = gcp.discover(refresh=True)
    if found.account:
        print(f"  credentials      {found.account}")
    for note in found.notes:
        print(f"  note             {note}")
    print()
    for project in found.projects:
        if not project.buckets and project.listedBy == "search":
            continue
        cache = {True: "NCEI cache", False: "", None: ""}[project.nceiCache]
        print(f"  {project.id}  {project.name}  {cache}".rstrip())
        for bucket in project.buckets:
            access = "read+write" if bucket.write else "read" if bucket.read else "none"
            print(f"      gs://{bucket.name:<40} {access}")
        if not project.buckets:
            print(f"      ({project.detail or 'no bucket you can use'})")
    hidden = sum(1 for p in found.projects if not p.buckets and p.listedBy == "search")
    if hidden:
        print(f"\n  ({hidden} more projects you can see have no bucket you can use.)")
    print(f"\n  In force: {_context_line(found.context)}")
    if found.autoSelected:
        print("  (chosen for you: the only bucket you can write to)")
    print("  Choose:   aa-workbench project PROJECT_ID [--bucket NAME]\n")


def _context_line(context) -> str:  # noqa: ANN001 - a GcpContext
    if not context.bucket:
        return "nothing chosen"
    project = context.project or "(unknown project)"
    return f"gs://{context.bucket} in {project} ({context.source})"


def cmd_url(args: argparse.Namespace) -> None:
    """Where to open the Workbench, and how to get the same address every time."""
    from .api.address import address

    os.environ.setdefault("AASI_PORT", str(args.port))
    here = address()
    if here.url:
        print(f"This workstation:  {here.url}")
        print("  Bookmark it. It stays the same while this workstation exists and the")
        print(f"  Workbench runs on port {here.port}. If a link you were given ends")
        print("  in ?_workstationAccessToken=…, drop that: it is a one-time sign-in.")
        print()
        print("From your own computer (with gcloud), one address for any workstation:")
        print(f"  {here.tunnel}")
        print(f"  then open {here.localUrl}  (PROJECT, REGION, CLUSTER, CONFIG:")
        print("  from the workstation's page in the Cloud console)")
    else:
        print(f"Not on a Cloud Workstation (no $WEB_HOST): open {here.localUrl}")
    print()
    print("A team-wide address: docs/guides/stable-address.md")


def cmd_build(_args: argparse.Namespace) -> None:
    _build_frontend()
    print(f"UI built at: {_paths.frontend_dist_dir()}")


def cmd_serve(args: argparse.Namespace) -> None:
    os.environ["AASI_NCEI_SOURCE"] = args.source
    # Published so the environment updater can refuse to rewrite this venv
    # when the server is reachable from off-host (see api/environment.py).
    os.environ["AASI_BIND_HOST"] = args.host
    # The address panel (api/address.py) names the port it is reached on.
    os.environ["AASI_PORT"] = str(args.port)

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
    from .api.address import address

    here = address()
    banner = f"\n  AA-SI Workbench\n  → {url}\n"
    if here.url:
        # On a Cloud Workstation: the address that stays the same.
        banner += (
            f"  → {here.url}   (open this in your browser and bookmark it: it is\n"
            f"    the same every time you start the Workbench on this workstation)\n"
        )
    banner += f"  NCEI source: {args.source}   (Ctrl+C to stop)\n"
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

    p_url = sub.add_parser(
        "url", help="The address to open the Workbench at, and to bookmark."
    )
    p_url.add_argument(
        "--port", type=int, default=8000, help="The port it serves on (default 8000)."
    )
    p_url.set_defaults(func=cmd_url)

    p_build = sub.add_parser("build", help="Build the frontend for production.")
    p_build.set_defaults(func=cmd_build)

    p_check = sub.add_parser(
        "check",
        help="Pre-flight: are the console tools installed? Where do products go?",
    )
    p_check.set_defaults(func=cmd_check)

    p_project = sub.add_parser(
        "project",
        help="List the GCP projects and buckets you can use; choose one.",
    )
    p_project.add_argument(
        "project", nargs="?", default="", help="Project id to work in."
    )
    p_project.add_argument(
        "--bucket", default="", help="Bucket (default: <project>-data)."
    )
    p_project.add_argument(
        "--forget", action="store_true", help="Forget the choice."
    )
    p_project.set_defaults(func=cmd_project)

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
