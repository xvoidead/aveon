"""Запуск API отдельно от бота:  python run.py

Адрес и база — из переменных AVEON_HOST (127.0.0.1), AVEON_PORT (8787), AVEON_DB (aveon.db рядом).
"""
import os

import uvicorn

from aveon_api.app import app

if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.environ.get("AVEON_HOST", "127.0.0.1"),
        port=int(os.environ.get("AVEON_PORT", "8787")),
        proxy_headers=True,
    )
