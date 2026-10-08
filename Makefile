# Millionaire City (TypeScript rewrite). Requires Node 20+ and npm. `make help` lists the targets.
SHELL := /bin/bash
PORT ?= 31803
DB ?= $(HOME)/mcity.sqlite
# OPT: auto = use apps/client/public-opt when it exists; 1 = force optimised assets; 0 = original assets
OPT ?= auto
WORKSPACES = --workspace @mcity/shared --workspace @mcity/rules --workspace @mcity/server --workspace @mcity/client --include-workspace-root

.PHONY: help install build run dev test typecheck check clean bundle bundle-small app app-stage missions-status

help:
	@echo "make install       npm ci for the game workspaces"
	@echo "make build         build the client (apps/client/dist); OPT=1|0|auto selects optimised assets"
	@echo "make run           start the server on PORT=$(PORT) (builds first if needed); saves in DB=$(DB)"
	@echo "make dev           server + Vite dev client with hot reload (client on :5176)"
	@echo "make test          client, server and rules unit tests"
	@echo "make typecheck     tsc --noEmit for the client"
	@echo "make check         typecheck + test"
	@echo "make bundle        zip of the sources to build elsewhere (tools/make-bundle.sh); bundle-small uses optimised assets"
	@echo "make app           Electron desktop package for this OS (tools/app -> tools/app/release/*.zip)"
	@echo "make missions-status  regenerate docs/missions-status.md"
	@echo "make clean         remove build output"

install:
	npm ci $(WORKSPACES)

build:
	npm run build -w @mcity/shared
	@if [ "$(OPT)" = "1" ] || { [ "$(OPT)" = "auto" ] && [ -d apps/client/public-opt ]; }; then \
	  echo "building client with optimised assets"; cd apps/client && MCITY_OPT=1 npx vite build; \
	else cd apps/client && npx vite build; fi

run:
	@[ -d apps/client/dist ] || $(MAKE) build
	cd apps/server && MCITY_HTTP_PORT=$(PORT) MCITY_DB_PATH=$(DB) MCITY_DISABLE_FB_SHIM=1 npx tsx src/main.ts

dev:
	@echo "server on :$(PORT), client dev server on :5176"
	@(cd apps/server && MCITY_HTTP_PORT=$(PORT) MCITY_DB_PATH=$(DB) MCITY_DISABLE_FB_SHIM=1 npx tsx src/main.ts) & \
	 SERVER=$$!; trap 'kill $$SERVER 2>/dev/null' EXIT INT TERM; cd apps/client && MCITY_SERVER=http://127.0.0.1:$(PORT) npx vite

test:
	npm run test -w @mcity/client
	npm run test -w @mcity/server
	npm run test -w @mcity/rules

typecheck:
	cd apps/client && npx tsc --noEmit

check: typecheck test

bundle:
	tools/make-bundle.sh

bundle-small:
	tools/make-bundle.sh mcity-rewrite-bundle-small.zip --small

app:
	cd tools/app && npm install --no-audit --no-fund && node build.mjs --pack

app-stage:
	node tools/app/build.mjs

missions-status:
	python3 tools/missions/mark.py

clean:
	rm -rf apps/client/dist tools/app/stage tools/app/release
