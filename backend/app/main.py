from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
from datetime import datetime

from app.routes import upload, rules, config, projects, admin, auth, users

app = FastAPI()

# Version ID changes on each app restart
_APP_START_TIME = datetime.now().isoformat()

# Auto-seed demo data if empty (for demo/first-run scenarios)
def _auto_seed_if_empty():
    """Load demo data if database is empty."""
    try:
        from app.routes.upload import FILES_DB, save_files_state
        from app.routes.projects import PROJECTS_DB, save_projects_state
        from app.db.user_store import USERS_DB, save_users_state, _seed_defaults_if_needed
        from app.models.project import ProjectNode
        from pytz import timezone
        
        # Only seed if both projects and files are empty
        if len(FILES_DB) == 0 and len(PROJECTS_DB) == 0:
            print("🌱 Auto-seeding demo data...")
            
            # 1. Seed default users
            _seed_defaults_if_needed()
            
            # 2. Add demo users
            demo_users = [
                {"id": "user-demo-1", "username": "juan_responsable", "role": "responsable", "roles": ["responsable"]},
                {"id": "user-demo-2", "username": "maria_responsable", "role": "responsable", "roles": ["responsable"]},
                {"id": "user-demo-3", "username": "carlos_conf", "role": "configurador", "roles": ["configurador"]},
            ]
            for u in demo_users:
                if u["id"] not in USERS_DB:
                    USERS_DB[u["id"]] = u
            save_users_state()
            
            # 3. Create project hierarchy
            empresa = ProjectNode(
                id="empresa-1", name="ACME Corp", level=1, parent_id=None, created_at=datetime.now().isoformat()
            )
            dept_ventas = ProjectNode(
                id="dept-1", name="Departamento Ventas", level=2, parent_id="empresa-1", created_at=datetime.now().isoformat()
            )
            dept_ops = ProjectNode(
                id="dept-2", name="Departamento Operaciones", level=2, parent_id="empresa-1", created_at=datetime.now().isoformat()
            )
            proj_leads = ProjectNode(
                id="proj-1", name="Proyecto Leads", level=3, parent_id="dept-1", created_at=datetime.now().isoformat()
            )
            proj_funnels = ProjectNode(
                id="proj-2", name="Proyecto Funnels", level=3, parent_id="dept-1", created_at=datetime.now().isoformat()
            )
            proj_inventory = ProjectNode(
                id="proj-3", name="Proyecto Inventario", level=3, parent_id="dept-2", created_at=datetime.now().isoformat()
            )
            proj_billing = ProjectNode(
                id="proj-4", name="Proyecto Facturación", level=3, parent_id="dept-2", created_at=datetime.now().isoformat()
            )
            
            empresa.children = [dept_ventas, dept_ops]
            dept_ventas.children = [proj_leads, proj_funnels]
            dept_ops.children = [proj_inventory, proj_billing]
            
            PROJECTS_DB.clear()
            PROJECTS_DB["empresa-1"] = empresa
            save_projects_state()
            
            # 4. Create processes with schedules
            _SCL = timezone("America/Santiago")
            now = datetime.now(_SCL)
            from datetime import timedelta
            
            processes = [
                {
                    "id": "proc-leads-daily",
                    "process_name": "Extracción diaria de Leads",
                    "project_id": "proj-1",
                    "latest_input_name": "leads.csv",
                    "frequency": "daily",
                    "commitment_schedule_set_at": (now - timedelta(days=30)).isoformat(),
                    "commitment_schedule": [{"day_of_week": i, "hour": 6, "minute": 0} for i in range(7)],
                    "executions": [{"timestamp": (now - timedelta(days=d, hours=1)).isoformat(), "uploaded_by": "SYSTEM"} for d in range(7)]
                },
                {
                    "id": "proc-leads-weekly",
                    "process_name": "Reporte semanal de Leads",
                    "project_id": "proj-1",
                    "latest_input_name": "leads-report.xlsx",
                    "frequency": "weekly",
                    "commitment_schedule_set_at": (now - timedelta(days=15)).isoformat(),
                    "commitment_schedule": [{"day_of_week": 1, "hour": 9, "minute": 0}],
                    "executions": [{"timestamp": (now - timedelta(days=d*7, hours=2)).isoformat(), "uploaded_by": "juan_responsable"} for d in range(4)]
                },
                {
                    "id": "proc-funnels-monthly",
                    "process_name": "Análisis mensual de Funnels",
                    "project_id": "proj-2",
                    "latest_input_name": "funnels-analysis.xlsx",
                    "frequency": "monthly",
                    "commitment_schedule_set_at": (now - timedelta(days=60)).isoformat(),
                    "commitment_schedule": [{"day_of_month": 1, "hour": 8, "minute": 0}],
                    "executions": [
                        {"timestamp": (now - timedelta(days=30)).isoformat(), "uploaded_by": "maria_responsable"},
                        {"timestamp": (now - timedelta(days=60)).isoformat(), "uploaded_by": "maria_responsable"},
                    ]
                },
                {
                    "id": "proc-inventory-real-time",
                    "process_name": "Actualización de Inventario (Real-time)",
                    "project_id": "proj-3",
                    "latest_input_name": "inventory.csv",
                    "frequency": "hourly",
                    "commitment_schedule_set_at": (now - timedelta(days=90)).isoformat(),
                    "commitment_schedule": [{"hour": h, "minute": 0} for h in range(24)],
                    "executions": [{"timestamp": (now - timedelta(hours=h)).isoformat(), "uploaded_by": "SYSTEM"} for h in range(24)]
                },
                {
                    "id": "proc-billing-weekly",
                    "process_name": "Generación de facturas semanales",
                    "project_id": "proj-4",
                    "latest_input_name": "invoices.csv",
                    "frequency": "weekly",
                    "commitment_schedule_set_at": (now - timedelta(days=45)).isoformat(),
                    "commitment_schedule": [{"day_of_week": 5, "hour": 17, "minute": 0}],
                    "executions": [{"timestamp": (now - timedelta(days=d*7, hours=3)).isoformat(), "uploaded_by": "carlos_conf"} for d in range(2)]
                },
            ]
            
            FILES_DB.clear()
            for p in processes:
                FILES_DB[p["id"]] = p
            save_files_state()
            
            # 5. Assign roles
            USERS_DB["user-demo-1"]["assigned_project_ids"] = ["proc-leads-daily", "proc-leads-weekly"]
            USERS_DB["user-demo-2"]["assigned_project_ids"] = ["proc-funnels-monthly", "proc-inventory-real-time"]
            USERS_DB["user-demo-3"]["assigned_project_ids"] = ["proc-billing-weekly"]
            save_users_state()
            
            print(f"✅ Demo data seeded: {len(PROJECTS_DB)} projects, {len(FILES_DB)} processes, {len(USERS_DB)} users")
    except Exception as e:
        print(f"⚠️ Auto-seed skipped (might already be initialized): {e}")

# Auto-seed on startup
_auto_seed_if_empty()

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