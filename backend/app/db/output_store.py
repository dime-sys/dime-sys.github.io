"""In-memory stores for the Output Delivery module."""
from typing import Dict, List

from app.db.database import load_snapshot, save_snapshot


SUBSCRIPTIONS_NAMESPACE = "output_subscriptions"
DELIVERY_JOBS_NAMESPACE = "output_delivery_jobs"
ARTIFACTS_NAMESPACE = "output_artifacts"

# { id -> subscription_dict }
SUBSCRIPTIONS_DB: Dict[str, dict] = load_snapshot(SUBSCRIPTIONS_NAMESPACE, dict)

# [ delivery_job_dict, ... ]
DELIVERY_JOBS_DB: List[dict] = load_snapshot(DELIVERY_JOBS_NAMESPACE, list)

# [ artifact_dict, ... ]
ARTIFACTS_DB: List[dict] = load_snapshot(ARTIFACTS_NAMESPACE, list)


def save_subscriptions_state() -> None:
	save_snapshot(SUBSCRIPTIONS_NAMESPACE, SUBSCRIPTIONS_DB)


def save_delivery_jobs_state() -> None:
	save_snapshot(DELIVERY_JOBS_NAMESPACE, DELIVERY_JOBS_DB)


def save_artifacts_state() -> None:
	save_snapshot(ARTIFACTS_NAMESPACE, ARTIFACTS_DB)
