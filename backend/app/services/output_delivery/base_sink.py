from abc import ABC, abstractmethod

import pandas as pd

from .contracts import ArtifactResult, OutputContract


class BaseSink(ABC):
    """Abstract interface all output connectors must implement."""

    provider: str = "base"

    @abstractmethod
    def write(self, contract: OutputContract, df: pd.DataFrame) -> ArtifactResult:
        """Persist *df* and return an ArtifactResult describing the write."""
        ...

    def validate_config(self, config: dict) -> None:
        """Optional: raise ValueError if required config keys are missing."""
        pass
