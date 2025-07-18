# llmchat_web/routes/task_routes.py
"""
Flask routes for task management proxy functionality.
Forwards requests to the llmcore API server's task management endpoints.
"""

import json
import logging
from flask import Blueprint, jsonify, request, Response, stream_with_context
from ..app import async_to_sync_in_flask, logger as app_logger
from ..services.llmcore_api_client import get_api_client

# Create blueprint for task management routes
task_bp = Blueprint('task_bp', __name__, url_prefix='/api/tasks')

logger = logging.getLogger("llmchat_web.routes.task")
if not logger.handlers and app_logger:
    logger.parent = logging.getLogger("llmchat_web.routes")
    if logger.parent and logger.parent.level:
        logger.setLevel(logger.parent.level)
    else:
        logger.setLevel(app_logger.level if app_logger else logging.DEBUG)


@task_bp.route("/<task_id>", methods=["GET"])
@async_to_sync_in_flask
async def get_task_status(task_id: str):
    """Proxy route for getting task status from llmcore API."""
    try:
        api_client = get_api_client()
        status_data = await api_client.get_task_status(task_id)
        return jsonify(status_data)
    except Exception as e:
        logger.error(f"Error getting task status for {task_id}: {e}")
        return jsonify({"error": str(e)}), 500


@task_bp.route("/<task_id>/result", methods=["GET"])
@async_to_sync_in_flask
async def get_task_result(task_id: str):
    """Proxy route for getting task result from llmcore API."""
    try:
        api_client = get_api_client()
        result_data = await api_client.get_task_result(task_id)
        return jsonify(result_data)
    except Exception as e:
        logger.error(f"Error getting task result for {task_id}: {e}")
        return jsonify({"error": str(e)}), 500


@task_bp.route("/<task_id>/stream", methods=["GET"])
@async_to_sync_in_flask
async def stream_task_progress(task_id: str):
    """
    Proxy route for streaming task progress from llmcore API.
    Forwards the Server-Sent Events stream to the client.
    """
    try:
        api_client = get_api_client()

        def stream_generator():
            """Generator that yields SSE data from the llmcore API."""
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
                'Connection': 'keep-alive'
            }
        )

    except Exception as e:
        logger.error(f"Error streaming task progress for {task_id}: {e}")
        return jsonify({"error": str(e)}), 500


logger.info("Task management proxy routes defined on task_bp.")
