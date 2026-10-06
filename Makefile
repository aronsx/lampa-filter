.PHONY: test run

test:
	node test/test-lampa-filters.js

run:
	uv run --with fastapi --with httpx --with uvicorn mock.py
