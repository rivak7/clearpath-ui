PY = python3
PIP = pip3

.PHONY: install dev test lint format build map fetch distance

install:
	$(PIP) install -e .

dev:
	$(PIP) install -e .[dev]

test:
	pytest -q

lint:
	ruff check src tests

format:
	black src tests

build:
	$(PY) -m build

map:
	$(PY) -m satdist.cli map --south 47.6006395 --west -122.139536 --north 47.6008162 --east -122.1392861

fetch:
	$(PY) -m satdist.cli fetch --south 47.6006395 --west -122.139536 --north 47.6008162 --east -122.1392861 --width 1024 --height 1024

distance:
	$(PY) -m satdist.cli distance --lat1 47.6007247 --lon1 -122.139411 --lat2 47.6007247 --lon2 -122.139300

