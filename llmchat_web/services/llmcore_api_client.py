# llmchat_web/services/llmcore_api_client.py
"""
HTTP client for communicating with the llmcore API service.

This module provides a centralized client for making HTTP requests to the
llmcore API server, handling authentication, error handling, and response parsing.
"""

import asyncio
import atexit
import json
import logging
import os
import weakref
from typing import Any, Dict, List, Optional, Union

import httpx

logger = logging.getLogger(__name__)

# Global registry for cleanup
_client_registry = weakref.WeakSet()


class LLMCoreAPIClient:
    """
    Asynchronous HTTP client for the llmcore API.

    This client handles all communication with the llmcore API server,
    providing methods for chat, task management, ingestion, and other operations.
    """

    def __init__(self, base_url: Optional[str] = None, timeout: float = 30.0):
        """
        Initialize the API client.

        Args:
            base_url: Base URL of the llmcore API server
            timeout: Default timeout for HTTP requests
        """
        self.base_url = base_url or os.getenv('LLMCORE_API_URL', 'http://localhost:8000')
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

        # Register this client for cleanup
        _client_registry.add(self)

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout
            )
        return self._client

    async def close(self):
        """Close the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None

    async def get_health(self) -> Dict[str, Any]:
        """Get the health status of the llmcore service."""
        client = await self._get_client()
        response = await client.get("/health")
        response.raise_for_status()
        return response.json()

    async def get_info(self) -> Dict[str, Any]:
        """Get API and service information."""
        client = await self._get_client()
        response = await client.get("/api/v1/info")
        response.raise_for_status()
        return response.json()

    async def submit_ingestion_task(
        self,
        ingest_type: str,
        collection_name: str,
        files: Optional[List[Any]] = None,
        zip_file: Optional[Any] = None,
        repo_name: Optional[str] = None,
        git_url: Optional[str] = None,
        git_ref: Optional[str] = "HEAD"
    ) -> Dict[str, Any]:
        """
        Submit a data ingestion task to the llmcore API.

        Args:
            ingest_type: Type of ingestion ('file', 'dir_zip', 'git')
            collection_name: Target collection name
            files: List of file objects for file ingestion
            zip_file: ZIP file object for directory ingestion
            repo_name: Repository identifier name
            git_url: Git repository URL
            git_ref: Git branch/tag/commit reference

        Returns:
            Response containing task_id and message
        """
        client = await self._get_client()

        # Prepare form data
        data = {
            "ingest_type": ingest_type,
            "collection_name": collection_name
        }

        # Prepare files for upload
        files_to_upload = {}

        if ingest_type == "file" and files:
            # Handle multiple file uploads
            files_to_upload["files"] = []
            for file_obj in files:
                if hasattr(file_obj, 'read'):
                    # File-like object
                    files_to_upload["files"].append(
                        (file_obj.filename, file_obj.read(), file_obj.content_type)
                    )
                else:
                    # Assume it's a path or file content
                    files_to_upload["files"].append(file_obj)

        elif ingest_type == "dir_zip" and zip_file:
            if hasattr(zip_file, 'read'):
                files_to_upload["zip_file"] = (
                    zip_file.filename, zip_file.read(), zip_file.content_type
                )
            else:
                files_to_upload["zip_file"] = zip_file
            if repo_name:
                data["repo_name"] = repo_name

        elif ingest_type == "git":
            if git_url:
                data["git_url"] = git_url
            if repo_name:
                data["repo_name"] = repo_name
            if git_ref:
                data["git_ref"] = git_ref

        response = await client.post(
            "/api/v2/ingestion/submit",
            data=data,
            files=files_to_upload if files_to_upload else None
        )
        response.raise_for_status()
        return response.json()

    async def get_task_status(self, task_id: str) -> Dict[str, Any]:
        """Get the status of an asynchronous task."""
        client = await self._get_client()
        response = await client.get(f"/api/v2/tasks/{task_id}")
        response.raise_for_status()
        return response.json()

    async def get_task_result(self, task_id: str) -> Dict[str, Any]:
        """Get the result of a completed task."""
        client = await self._get_client()
        response = await client.get(f"/api/v2/tasks/{task_id}/result")
        response.raise_for_status()
        return response.json()

    async def stream_task_progress(self, task_id: str):
        """
        Stream real-time progress updates for a task using Server-Sent Events.

        Args:
            task_id: The unique identifier of the task to stream

        Yields:
            Dictionary containing progress updates and events
        """
        client = await self._get_client()
        async with client.stream("GET", f"/api/v2/tasks/{task_id}/stream") as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    try:
                        data = line[6:]  # Remove "data: " prefix
                        if data.strip():
                            yield json.loads(data)
                    except json.JSONDecodeError:
                        # Skip malformed JSON lines
                        continue

    async def search_semantic_memory(
        self,
        query: str,
        collection_name: Optional[str] = None,
        k: int = 3
    ) -> List[Dict[str, Any]]:
        """Search the semantic memory (vector store)."""
        client = await self._get_client()
        params = {"query": query, "k": k}
        if collection_name:
            params["collection_name"] = collection_name

        response = await client.get("/api/v2/memory/semantic/search", params=params)
        response.raise_for_status()
        return response.json()

    async def __aenter__(self):
        """Async context manager entry."""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.close()


# Global client instance for use in Flask routes
_global_client: Optional[LLMCoreAPIClient] = None


def get_api_client() -> LLMCoreAPIClient:
    """Get the global API client instance."""
    global _global_client
    if _global_client is None:
        _global_client = LLMCoreAPIClient()
    return _global_client


async def close_api_client():
    """Close the global API client."""
    global _global_client
    if _global_client:
        await _global_client.close()
        _global_client = None


async def cleanup_all_clients():
    """
    Cleanup function to close all active API clients.
    This is registered with atexit to ensure proper cleanup.
    """
    logger.info("Cleaning up all LLMCore API clients...")
    cleanup_tasks = []

    # Create a copy of the registry since it might change during iteration
    clients_to_close = list(_client_registry)

    for client in clients_to_close:
        if client._client is not None:
            cleanup_tasks.append(client.close())

    if cleanup_tasks:
        try:
            await asyncio.gather(*cleanup_tasks, return_exceptions=True)
            logger.info(f"Cleaned up {len(cleanup_tasks)} API clients")
        except Exception as e:
            logger.error(f"Error during API client cleanup: {e}")


def _sync_cleanup():
    """Synchronous wrapper for cleanup, used with atexit."""
    try:
        loop = asyncio.get_event_loop()
        if not loop.is_closed():
            loop.run_until_complete(cleanup_all_clients())
    except Exception as e:
        # Ignore cleanup errors during shutdown
        pass


# Register cleanup function
atexit.register(_sync_cleanup)
