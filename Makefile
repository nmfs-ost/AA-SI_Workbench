# AA-SI Workbench — common developer tasks
.DEFAULT_GOAL := help
.PHONY: help setup setup-frontend setup-backend dev lint test build clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

setup: setup-frontend setup-backend ## Install all dependencies

setup-frontend: ## Install frontend dependencies
	cd frontend && npm install

setup-backend: ## Create venv and install backend (editable, with dev extras)
	cd backend && python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"

dev: ## Run the frontend dev server
	cd frontend && npm run dev

lint: ## Lint frontend and backend
	# The frontend's gate is the TypeScript compiler: strict mode with
	# noUnusedLocals/noUnusedParameters catches what a linter would, and the
	# repo carries no eslint config to run instead.
	cd frontend && npm run typecheck
	cd backend && ruff check .

test: ## Run frontend and backend tests
	cd frontend && npm test
	cd backend && pytest

build: ## Production build of the frontend
	cd frontend && npm run build

clean: ## Remove build artifacts and caches
	rm -rf frontend/dist frontend/node_modules/.vite
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
	rm -rf backend/.pytest_cache backend/.ruff_cache
