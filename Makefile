# Millionaire City (TypeScript client + Rust server). Requires Node 20+, npm and a Rust toolchain (cargo). `make help` lists the targets.
SHELL := /bin/bash
PORT ?= 31803
DB ?= $(HOME)/mcity.sqlite
# OPT: auto = use apps/client/public-opt when it exists; 1 = force optimised assets; 0 = original assets
OPT ?= auto
# Cargo may build outside apps/server-rs/target (CARGO_TARGET_DIR or ~/.cargo/config.toml target-dir); ask cargo.
SERVER_BIN = $(shell node tools/server-binary.mjs)

.PHONY: help install build server run dev conformance test typecheck check clean bundle bundle-small app app-dev missions-status

help:
	@echo "make install       npm ci for the game workspaces"
	@echo "make build         build the client (apps/client/dist); OPT=1|0|auto selects optimised assets"
	@echo "make server        build the Rust server (cargo build --release in apps/server-rs)"
	@echo "make run           start the Rust server on PORT=$(PORT) (builds the client and server first if needed); saves in DB=$(DB)"
	@echo "make dev           server + Vite dev client with hot reload (client on :5176)"
	@echo "make test          client and rules unit tests plus cargo test for the Rust server"
	@echo "make conformance   black-box conformance suite against the release server binary (tools/conformance)"
	@echo "make typecheck     tsc --noEmit for the client"
	@echo "make check         typecheck + test"
	@echo "make bundle        zip of the sources to build elsewhere (tools/make-bundle.sh); bundle-small uses optimised assets"
	@echo "make app           Tauri desktop installer for this OS (apps/desktop; output in apps/desktop/src-tauri/target/release/bundle/)"
	@echo "make app-dev       run the Tauri desktop app from the repository (debug build)"
	@echo "make missions-status  regenerate docs/missions-status.md"
	@echo "make clean         remove build output"

install:
	npm ci

build:
	npm run build -w @mcity/shared
	@if [ "$(OPT)" = "1" ] || { [ "$(OPT)" = "auto" ] && [ -d apps/client/public-opt ]; }; then \
	  echo "building client with optimised assets"; cd apps/client && MCITY_OPT=1 npx vite build; \
	else cd apps/client && npx vite build; fi

server:
	cd apps/server-rs && cargo build --release

# run/dev/conformance always go through cargo (a no-op in about a second when nothing changed), so edited server code is rebuilt.
run: server
	@[ -d apps/client/dist ] || $(MAKE) build
	MCITY_HTTP_PORT=$(PORT) MCITY_DB_PATH=$(DB) MCITY_DISABLE_FB_SHIM=1 $(SERVER_BIN)

dev: server
	@echo "server on :$(PORT), client dev server on :5176"
	@(MCITY_HTTP_PORT=$(PORT) MCITY_DB_PATH=$(DB) MCITY_DISABLE_FB_SHIM=1 $(SERVER_BIN)) & \
	 SERVER=$$!; trap 'kill $$SERVER 2>/dev/null' EXIT INT TERM; cd apps/client && MCITY_SERVER=http://127.0.0.1:$(PORT) npx vite

test: server
	npm run test -w @mcity/client
	npm run test -w @mcity/rules
	cd apps/server-rs && cargo test

typecheck:
	cd apps/client && npx tsc --noEmit

conformance: server
	npm run conformance -w @mcity/conformance

check: typecheck test

bundle:
	tools/make-bundle.sh

bundle-small:
	tools/make-bundle.sh mcity-rewrite-bundle-small.zip --small

app:
	npm --prefix apps/desktop ci && npm --prefix apps/desktop run build

app-dev:
	npm --prefix apps/desktop ci && npm --prefix apps/desktop run dev

missions-status:
	python3 tools/missions/mark.py

clean:
	rm -rf apps/client/dist apps/desktop/src-tauri/target
