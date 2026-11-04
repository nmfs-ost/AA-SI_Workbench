"""aa-workbench's command line."""

from __future__ import annotations

from aa_si_workbench.cli import build_parser, cmd_serve, cmd_url


def test_bare_aa_workbench_takes_serves_options():
    # aa-setup tells people to run `aa-workbench --open`; it used to fail
    # with "unrecognized arguments: --open".
    args = build_parser().parse_args(["--open", "--port", "8001"])
    assert args.func is cmd_serve
    assert (args.open_browser, args.port, args.host) == (True, 8001, "127.0.0.1")


def test_bare_aa_workbench_is_serve_with_its_defaults():
    args = build_parser().parse_args([])
    assert args.func is cmd_serve
    assert (args.open_browser, args.port, args.source, args.no_build) == (
        False,
        8000,
        "s3",
        False,
    )


def test_subcommands_keep_their_own_options():
    assert build_parser().parse_args(["serve", "--open"]).open_browser is True
    url = build_parser().parse_args(["url", "--port", "9000"])
    assert url.func is cmd_url and url.port == 9000
