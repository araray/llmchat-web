# llmchat_web/services/llmcore_api_client.py
"""
HTTP API client for interacting with the LLMCore v1 API.

This module provides a centralized client for making HTTP requests to the
LLMCore API server, replacing direct library calls with HTTP communication.
"""

import os
import logging
from typing import Any, Dict, Optional, AsyncGenerator
import httpx
import json

logger = logging.getLogger(__name__)


class LLMCoreAPIClient:
    """
    Async HTTP client for the LLMCore v1 API.

    Manages connection pooling, error handling, and request/response formatting
    for all interactions with the LLMCore API server.
    """

    def __init__(self, base_url: Optional[str] = None):
        """
        Initialize the API client.

        Args:
            base_url: The base URL of the LLMCore API server.
                     If None, reads from LLMCORE_API_BASE_URL environment variable.
        """
        self.base_url = base_url or os.getenv(
            'LLMCORE_API_BASE_URL',
            'http://127.0.0.1:8000'
        )
        self.base_url = self.base_url.rstrip('/')  # Remove trailing slash

        # HTTP client configuration
        self.timeout = httpx.Timeout(30.0, connect=5.0)
        self.limits = httpx.Limits(max_keepalive_connections=20, max_connections=100)

        logger.info(f"LLMCore API client initialized with base URL: {self.base_url}")

    def _get_client(self) -> httpx.AsyncClient:
        """Create a configured httpx.AsyncClient instance."""
        return httpx.AsyncClient(
            timeout=self.timeout,
            limits=self.limits,
            http2=True
        )

    async def post_chat(self, payload: Dict[str, Any]) -> Any:
        """
        Send a chat request to the LLMCore API.

        Args:
            payload: The chat request payload matching ChatRequest model

        Returns:
            For non-streaming: Dict containing the chat response
            For streaming: AsyncGenerator yielding response chunks

        Raises:
            httpx.HTTPError: For HTTP-level errors
            ValueError: For invalid response format
        """
        url = f"{self.base_url}/api/v1/chat"

        async with self._get_client() as client:
            if payload.get('stream', False):
                return await self._handle_streaming_chat(client, url, payload)
            else:
                return await self._handle_non_streaming_chat(client, url, payload)

    async def _handle_non_streaming_chat(
        self,
        client: httpx.AsyncClient,
        url: str,
        payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle non-streaming chat requests."""
        try:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error in chat request: {e.response.status_code} - {e.response.text}")
            # Try to parse error response
            try:
                error_data = e.response.json()
                raise ValueError(error_data.get('detail', str(e)))
            except (json.JSONDecodeError, AttributeError):
                raise ValueError(f"HTTP {e.response.status_code}: {e.response.text}")
        except httpx.RequestError as e:
            logger.error(f"Request error in chat: {e}")
            raise ValueError(f"Failed to connect to LLMCore API: {str(e)}")

    async def _handle_streaming_chat(
        self,
        client: httpx.AsyncClient,
        url: str,
        payload: Dict[str, Any]
    ) -> AsyncGenerator[str, None]:
        """Handle streaming chat requests."""
        try:
            async with client.stream('POST', url, json=payload) as response:
                response.raise_for_status()

                async for chunk in response.aiter_lines():
                    if chunk.strip():  # Skip empty lines
                        yield chunk

        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error in streaming chat: {e.response.status_code}")
            # For streaming, we yield an error event in SSE format
            error_msg = f"HTTP {e.response.status_code}"
            try:
                error_data = e.response.json()
                error_msg = error_data.get('detail', error_msg)
            except (json.JSONDecodeError, AttributeError):
                pass

            yield f"data: {json.dumps({'type': 'error', 'error': error_msg})}\n\n"
            yield f"data: {json.dumps({'type': 'end'})}\n\n"

        except httpx.RequestError as e:
            logger.error(f"Request error in streaming chat: {e}")
            yield f"data: {json.dumps({'type': 'error', 'error': f'Failed to connect to LLMCore API: {str(e)}'})}\n\n"
            yield f"data: {json.dumps({'type': 'end'})}\n\n"

    async def get_health(self) -> Dict[str, Any]:
        """
        Check the health status of the LLMCore API.

        Returns:
            Dict containing health status information
        """
        url = f"{self.base_url}/health"

        async with self._get_client() as client:
            try:
                response = await client.get(url)
                response.raise_for_status()
                return response.json()
            except httpx.HTTPStatusError as e:
                logger.error(f"HTTP error in health check: {e.response.status_code}")
                return {
                    "status": "error",
                    "llmcore_available": False,
                    "error": f"HTTP {e.response.status_code}"
                }
            except httpx.RequestError as e:
                logger.error(f"Request error in health check: {e}")
                return {
                    "status": "error",
                    "llmcore_available": False,
                    "error": f"Connection failed: {str(e)}"
                }

    async def get_info(self) -> Dict[str, Any]:
        """
        Get API information from the LLMCore service.

        Returns:
            Dict containing API version and feature information
        """
        url = f"{self.base_url}/api/v1/info"

        async with self._get_client() as client:
            try:
                response = await client.get(url)
                response.raise_for_status()
                return response.json()
            except httpx.HTTPStatusError as e:
                logger.error(f"HTTP error getting API info: {e.response.status_code}")
                return {
                    "service_status": "error",
                    "error": f"HTTP {e.response.status_code}"
                }
            except httpx.RequestError as e:
                logger.error(f"Request error getting API info: {e}")
                return {
                    "service_status": "error",
                    "error": f"Connection failed: {str(e)}"
                }
