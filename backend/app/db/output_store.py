"""In-memory stores for the Output Delivery module."""
from typing import Dict, List

# { id -> subscription_dict }
SUBSCRIPTIONS_DB: Dict[str, dict] = {}

# [ delivery_job_dict, ... ]
DELIVERY_JOBS_DB: List[dict] = []

# [ artifact_dict, ... ]
ARTIFACTS_DB: List[dict] = []
