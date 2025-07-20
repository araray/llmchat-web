# llmchat_web/routes/agent_routes.py
"""
Flask routes for agent functionality proxy to LLMCore API.

This module provides Flask routes that proxy agent requests to the
LLMCore API server, enabling the web interface to access agentic functionality.
"""

import json
import logging
from typing import Any, Dict

from flask import Response, jsonify, request, stream_with_context

from . import agent_bp
from ..app import async_to_sync_in_flask, logger as app_logger
from ..services.llmcore_api_client import get_api_client

logger = logging.getLogger("llmchat_web.routes.agent")
if not logger.handlers and app_logger:
    logger.parent = logging.getLogger("llmchat_web.routes")
    if logger.parent and logger.parent.level:
        logger.setLevel(logger.parent.level)
    else:
        logger.setLevel(app_logger.level if app_logger else logging.DEBUG)


@agent_bp.route("/run", methods=["POST"])
@async_to_sync_in_flask
async def run_agent_route() -> Any:
    """
    Proxy route for starting an agent task via the LLMCore API.

    Expects JSON payload with:
    - goal: str (required) - High-level goal for the agent
    - session_id: str (optional) - Session ID for context
    - provider: str (optional) - LLM provider override
    - model: str (optional) - Model override

    Returns:
        JSON response with task_id and status
    """
    try:
        data = request.json
        if not data or "goal" not in data:
            logger.warning("Agent run request missing 'goal' field")
            return jsonify({"error": "Missing required field: goal"}), 400

        goal = data["goal"].strip()
        if not goal:
            logger.warning("Agent run request with empty goal")
            return jsonify({"error": "Goal cannot be empty"}), 400

        # Extract optional parameters
        session_id = data.get("session_id")
        provider_name = data.get("provider")
        model_name = data.get("model")

        logger.info(f"Starting agent task for goal: '{goal[:50]}...'")

        # Get API client and make request
        api_client = get_api_client()
        result = await api_client.run_agent(
            goal=goal,
            session_id=session_id,
            provider_name=provider_name,
            model_name=model_name
        )

        logger.info(f"Agent task started successfully. Task ID: {result.get('task_id')}")
        return jsonify(result), 202  # 202 Accepted

    except Exception as e:
        logger.error(f"Error starting agent task: {e}", exc_info=True)
        return jsonify({"error": f"Failed to start agent task: {str(e)}"}), 500


@agent_bp.route("/tasks/<task_id>", methods=["GET"])
@async_to_sync_in_flask
async def get_task_status_route(task_id: str) -> Any:
    """
    Proxy route for getting task status from the LLMCore API.

    Args:
        task_id: Unique identifier of the task

    Returns:
        JSON response with task status information
    """
    try:
        api_client = get_api_client()
        status_data = await api_client.get_task_status(task_id)

        logger.debug(f"Retrieved status for task {task_id}: {status_data.get('status')}")
        return jsonify(status_data)

    except Exception as e:
        logger.error(f"Error getting task status for {task_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to get task status: {str(e)}"}), 500


@agent_bp.route("/tasks/<task_id>/result", methods=["GET"])
@async_to_sync_in_flask
async def get_task_result_route(task_id: str) -> Any:
    """
    Proxy route for getting task result from the LLMCore API.

    Args:
        task_id: Unique identifier of the task

    Returns:
        JSON response with task result information
    """
    try:
        api_client = get_api_client()
        result_data = await api_client.get_task_result(task_id)

        logger.info(f"Retrieved result for completed task {task_id}")
        return jsonify(result_data)

    except Exception as e:
        logger.error(f"Error getting task result for {task_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to get task result: {str(e)}"}), 500


@agent_bp.route("/tasks/<task_id>/stream", methods=["GET"])
@async_to_sync_in_flask
async def stream_task_progress_route(task_id: str) -> Any:
    """
    Proxy route for streaming task progress from the LLMCore API.

    Args:
        task_id: Unique identifier of the task to stream

    Returns:
        Server-Sent Events stream with progress updates
    """
    try:
        api_client = get_api_client()

        def stream_generator():
            """Generator that yields SSE data from the LLMCore API."""
            import asyncio

            async def async_stream():
                async for event_data in api_client.stream_task_progress(task_id):
                    yield f"data: {json.dumps(event_data)}\n\n"

            # Run the async generator in the current event loop
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                async_gen = async_stream()
                while True:
                    try:
                        event = loop.run_until_complete(async_gen.__anext__())
                        yield event
                    except StopAsyncIteration:
                        break
            finally:
                loop.close()

        return Response(
            stream_with_context(stream_generator()),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            }
        )

    except Exception as e:
        logger.error(f"Error streaming task progress for {task_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to stream task progress: {str(e)}"}), 500


logger.info("Agent proxy routes defined on agent_bp.")


@agent_bp.route("/run", methods=["POST"])
@async_to_sync_in_flask
async def run_agent_route() -> Any:
    """
    Proxy route for starting an agent task via the LLMCore API.

    Expects JSON payload with:
    - goal: str (required) - High-level goal for the agent
    - session_id: str (optional) - Session ID for context
    - provider: str (optional) - LLM provider override
    - model: str (optional) - Model override

    Returns:
        JSON response with task_id and status
    """
    try:
        data = request.json
        if not data or "goal" not in data:
            logger.warning("Agent run request missing 'goal' field")
            return jsonify({"error": "Missing required field: goal"}), 400

        goal = data["goal"].strip()
        if not goal:
            logger.warning("Agent run request with empty goal")
            return jsonify({"error": "Goal cannot be empty"}), 400

        # Extract optional parameters
        session_id = data.get("session_id")
        provider_name = data.get("provider")
        model_name = data.get("model")

        logger.info(f"Starting agent task for goal: '{goal[:50]}...'")

        # Get API client and make request
        api_client = get_api_client()
        result = await api_client.run_agent(
            goal=goal,
            session_id=session_id,
            provider_name=provider_name,
            model_name=model_name
        )

        logger.info(f"Agent task started successfully. Task ID: {result.get('task_id')}")
        return jsonify(result), 202  # 202 Accepted

    except Exception as e:
        logger.error(f"Error starting agent task: {e}", exc_info=True)
        return jsonify({"error": f"Failed to start agent task: {str(e)}"}), 500


@agent_bp.route("/tasks/<task_id>", methods=["GET"])
@async_to_sync_in_flask
async def get_task_status_route(task_id: str) -> Any:
    """
    Proxy route for getting task status from the LLMCore API.

    Args:
        task_id: Unique identifier of the task

    Returns:
        JSON response with task status information
    """
    try:
        api_client = get_api_client()
        status_data = await api_client.get_task_status(task_id)

        logger.debug(f"Retrieved status for task {task_id}: {status_data.get('status')}")
        return jsonify(status_data)

    except Exception as e:
        logger.error(f"Error getting task status for {task_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to get task status: {str(e)}"}), 500


@agent_bp.route("/tasks/<task_id>/result", methods=["GET"])
@async_to_sync_in_flask
async def get_task_result_route(task_id: str) -> Any:
    """
    Proxy route for getting task result from the LLMCore API.

    Args:
        task_id: Unique identifier of the task

    Returns:
        JSON response with task result information
    """
    try:
        api_client = get_api_client()
        result_data = await api_client.get_task_result(task_id)

        logger.info(f"Retrieved result for completed task {task_id}")
        return jsonify(result_data)

    except Exception as e:
        logger.error(f"Error getting task result for {task_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to get task result: {str(e)}"}), 500


@agent_bp.route("/tasks/<task_id>/stream", methods=["GET"])
@async_to_sync_in_flask
async def stream_task_progress_route(task_id: str) -> Any:
    """
    Proxy route for streaming task progress from the LLMCore API.

    Args:
        task_id: Unique identifier of the task to stream

    Returns:
        Server-Sent Events stream with progress updates
    """
    try:
        api_client = get_api_client()

        def stream_generator():
            """Generator that yields SSE data from the LLMCore API."""
            import asyncio

            async def async_stream():
                async for event_data in api_client.stream_task_progress(task_id):
                    yield f"data: {json.dumps(event_data)}\n\n"

            # Run the async generator in the current event loop
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                async_gen = async_stream()
                while True:
                    try:
                        event = loop.run_until_complete(async_gen.__anext__())
                        yield event
                    except StopAsyncIteration:
                        break
            finally:
                loop.close()

        return Response(
            stream_with_context(stream_generator()),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            }
        )

    except Exception as e:
        logger.error(f"Error streaming task progress for {task_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to stream task progress: {str(e)}"}), 500


logger.info("Agent proxy routes defined on agent_bp.")
