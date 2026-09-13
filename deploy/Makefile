# Bring-up for the LCARS World Monitor kiosk.
#
#   make -C deploy doctor    what is wrong, and how to fix it
#   make -C deploy models    fetch and verify the weights
#   make -C deploy up        sidecar + model server
#   make -C deploy kiosk     install the panel itself (needs root)
#
# Deliberately NOT the repository root Makefile: that one is upstream's, it
# drives their protobuf toolchain, and editing it would spend an upstream seam
# on our deployment story. See docs/UPSTREAM-DIFF.md.

SHELL       := /bin/bash
HERE        := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
ROOT        := $(abspath $(HERE)..)
COMPOSE     := docker compose -f $(ROOT)/voice-sidecar/docker-compose.yml
PY          ?= python3
MODEL_DIR   ?= $(HERE)models

.DEFAULT_GOAL := help

.PHONY: help doctor models up down restart logs kiosk kiosk-uninstall test

help: ## Show this help
	@echo "LCARS World Monitor — deployment"
	@echo
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "First run on a fresh machine:"
	@echo "  make -C deploy models && make -C deploy up && make -C deploy doctor"

doctor: ## Preflight: audio, wake model, model server, dashboard API, alert rules
	@cd $(ROOT)/voice-sidecar && $(PY) -m wm_voice.doctor

models: ## Fetch and verify model weights (see models.conf)
	@WM_MODEL_DIR=$(MODEL_DIR) $(HERE)fetch-models.sh

up: ## Start the sidecar and the model server
	@$(COMPOSE) up -d
	@echo "Started. 'make -C deploy doctor' once the model server has loaded."

down: ## Stop them
	@$(COMPOSE) down

restart: ## Restart them
	@$(COMPOSE) restart

logs: ## Follow the sidecar log
	@$(COMPOSE) logs -f voice

test: ## Run the sidecar test suite
	@cd $(ROOT)/voice-sidecar && $(PY) -m unittest discover -s tests -t .

kiosk: ## Install the kiosk profile (needs root)
	@if [ "$$(id -u)" -ne 0 ]; then echo "kiosk: run as root (sudo make -C deploy kiosk)"; exit 1; fi
	@set -e; \
	id -u kiosk >/dev/null 2>&1 || useradd -r -m -d /var/lib/wm-kiosk -s /usr/sbin/nologin kiosk; \
	command -v cage >/dev/null || apt-get install -y cage chromium; \
	install -m 0755 $(HERE)kiosk/wm-kiosk-launch.sh /usr/local/bin/wm-kiosk-launch.sh; \
	install -m 0644 $(HERE)kiosk/wm-kiosk.service /etc/systemd/system/wm-kiosk.service; \
	[ -f /etc/default/wm-kiosk ] || install -m 0644 $(HERE)kiosk/wm-kiosk.env.example /etc/default/wm-kiosk; \
	systemctl daemon-reload; \
	systemctl enable --now wm-kiosk.service; \
	echo "Installed. Edit /etc/default/wm-kiosk, then: systemctl restart wm-kiosk"

kiosk-uninstall: ## Remove the kiosk profile, leaving /etc/default/wm-kiosk
	@if [ "$$(id -u)" -ne 0 ]; then echo "run as root"; exit 1; fi
	@-systemctl disable --now wm-kiosk.service
	@rm -f /etc/systemd/system/wm-kiosk.service /usr/local/bin/wm-kiosk-launch.sh
	@systemctl daemon-reload
	@echo "Removed. /etc/default/wm-kiosk kept — delete it by hand if you meant to."
