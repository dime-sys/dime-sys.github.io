from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
from datetime import datetime

from app.routes import upload, rules, config, projects, admin, auth, users

app = FastAPI()

# Version ID changes on each app restart
_APP_START_TIME = datetime.now().isoformat()

# CORS origins can be overridden with CORS_ORIGINS="http://localhost,http://localhost:5173"
cors_origins_env = os.getenv("CORS_ORIGINS")
allowed_origins = [
    "http://localhost",
    "http://localhost:80",
    "http://localhost:5173",
    "http://127.0.0.1",
    "http://127.0.0.1:80",
    "http://127.0.0.1:5173",
]
if cors_origins_env:
    allowed_origins = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]

# 🔥 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Version endpoint (no auth required)
@app.get("/version")
def get_app_version():
    return {"version": _APP_START_TIME}

# Routers
app.include_router(upload.router, prefix="/upload", tags=["upload"])
app.include_router(rules.router, prefix="/rules", tags=["rules"])
app.include_router(config.router)
app.include_router(projects.router)
app.include_router(admin.router)
app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(users.router, prefix="/users", tags=["users"])