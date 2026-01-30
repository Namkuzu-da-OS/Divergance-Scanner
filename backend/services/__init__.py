"""Backend services module"""
from .data_client import DataClient, get_data_client, shutdown_data_client

__all__ = [
    "DataClient",
    "get_data_client",
    "shutdown_data_client",
]
