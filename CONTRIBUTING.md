# Contributing to AA-SI Workbench

Thanks for your interest in improving the AA-SI Workbench. This document explains
how to propose changes and what to expect from the review process.

By participating you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a bug** — open an issue using the *Bug report* template.
- **Request a feature** — open an issue using the *Feature request* template.
- **Improve documentation** — docs live in [`docs/`](docs/) and in each
  component's `README.md`.
- **Contribute code** — see the workflow below.

## Development workflow

1. **Fork** the repository (external contributors) or create a branch (members).
2. **Branch** from `main` using a descriptive name:
   - `feature/<short-description>`
   - `fix/<short-description>`
   - `docs/<short-description>`
3. **Make focused commits.** Write clear commit messages in the imperative mood
   ("Add terminal panel resize handling", not "added ...").
4. **Keep the tree green.** Run the relevant checks before pushing:
   - Frontend: `cd frontend && npm run lint && npm run typecheck && npm run build`
   - Backend: `cd backend && ruff check . && pytest`
5. **Open a pull request** against `main`, fill out the PR template, and link any
   related issues. Keep PRs small and reviewable.

CI must pass and at least one maintainer (see [CODEOWNERS](.github/CODEOWNERS))
must approve before a PR is merged.

## Coding standards

- **Frontend:** TypeScript with the project's ESLint/Prettier configuration.
  Prefer small, composable components; register new panels through the panel
  registry rather than wiring them ad hoc.
- **Backend:** Python formatted and linted with `ruff`, type-checked where
  practical, and covered by `pytest` tests. Follow the `src/` layout.
- Add or update tests and documentation alongside any behavioral change.

## Provenance of contributions

This project is developed by U.S. Government employees and external
collaborators. Contributions are accepted under the terms described in
[`LICENSE.md`](LICENSE.md). Do not contribute code you are not authorized to
release, and do not commit sensitive, embargoed, or personally identifiable data.

## Questions

Open a discussion or an issue. For anything sensitive, follow
[`SECURITY.md`](SECURITY.md).
