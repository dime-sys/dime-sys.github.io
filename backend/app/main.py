from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import upload, rules, config, projects, admin, auth, users

app = FastAPI()

# 🔥 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(upload.router, prefix="/upload", tags=["upload"])
app.include_router(rules.router, prefix="/rules", tags=["rules"])
app.include_router(config.router)
app.include_router(projects.router)
app.include_router(admin.router)
app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(users.router, prefix="/users", tags=["users"])