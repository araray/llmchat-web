# llmchat_web/routes/ingest_routes.py
"""
Flask routes for data ingestion functionalities in the llmchat-web application.
Now acts as a proxy to the llmcore API server's asynchronous ingestion service.
"""

import logging
from typing import Any, Dict

from flask import Response, request, jsonify
from werkzeug.utils import secure_filename

# Import the specific blueprint defined in the routes package's __init__.py
from . import ingest_bp

# Import shared components from the main app module (llmchat_web.app)
from ..app import (
    async_to_sync_in_flask,
    logger as app_logger
)

# Import the API client for communicating with llmcore
from ..services.llmcore_api_client import get_api_client

# Configure a local logger for this specific routes module
logger = logging.getLogger("llmchat_web.routes.ingest")
if not logger.handlers and app_logger:
    logger.parent = logging.getLogger("llmchat_web.routes")
    if logger.parent and logger.parent.level:
        logger.setLevel(logger.parent.level)
    else:
        logger.setLevel(app_logger.level if app_logger else logging.DEBUG)


@ingest_bp.route("", methods=["POST"])
@async_to_sync_in_flask
async def ingest_data_route() -> Response:
    """
    Handles data ingestion requests by forwarding them to the llmcore API server.

    This route now acts as a simple proxy that:
    1. Validates the incoming request
    2. Forwards the request to the llmcore /api/v2/ingestion/submit endpoint
    3. Returns the task_id to the frontend for polling

    The actual ingestion processing is handled asynchronously by the llmcore TaskMaster service.
    """
    try:
        # Extract form data
        ingest_type = request.form.get("ingest_type")
        collection_name = request.form.get("collection_name")

        if not ingest_type or not collection_name:
            logger.warning("Ingestion request missing 'ingest_type' or 'collection_name'.")
            return jsonify({
                "error": "Missing required fields: ingest_type and collection_name"
            }), 400

        logger.info(f"Received ingestion request. Type: {ingest_type}, Collection: {collection_name}")

        # Get the API client
        api_client = get_api_client()

        # Prepare parameters based on ingestion type
        submit_params = {
            "ingest_type": ingest_type,
            "collection_name": collection_name
        }

        if ingest_type == "file":
            uploaded_files = request.files.getlist("files[]")
            if not uploaded_files or not any(f.filename for f in uploaded_files):
                logger.warning(f"File ingestion request for '{collection_name}' received no files.")
                return jsonify({
                    "error": "No files provided for file ingestion"
                }), 400

            # Prepare files for API client
            submit_params["files"] = uploaded_files

        elif ingest_type == "dir_zip":
            zip_file = request.files.get("zip_file")
            if not zip_file or not zip_file.filename:
                logger.warning(f"Directory ZIP ingestion request for '{collection_name}' received no ZIP file.")
                return jsonify({
                    "error": "No ZIP file provided for directory ingestion"
                }), 400

            submit_params["zip_file"] = zip_file
            submit_params["repo_name"] = request.form.get("repo_name")

        elif ingest_type == "git":
            git_url = request.form.get("git_url")
            repo_name = request.form.get("repo_name")
            git_ref = request.form.get("git_ref", "HEAD")

            if not git_url or not repo_name:
                logger.warning(f"Git ingestion request missing required parameters.")
                return jsonify({
                    "error": "Missing Git URL or repository identifier for Git ingestion"
                }), 400

            submit_params["git_url"] = git_url
            submit_params["repo_name"] = repo_name
            submit_params["git_ref"] = git_ref

        else:
            logger.warning(f"Unsupported ingestion type received: {ingest_type}")
            return jsonify({
                "error": f"Unsupported ingestion type: {ingest_type}"
            }), 400

        # Submit the ingestion task to the llmcore API
        try:
            response_data = await api_client.submit_ingestion_task(**submit_params)

            logger.info(f"Successfully submitted {ingest_type} ingestion task. Task ID: {response_data.get('task_id')}")

            return jsonify({
                "task_id": response_data["task_id"],
                "message": response_data["message"],
                "status": "submitted"
            })

        except Exception as api_error:
            logger.error(f"Error submitting ingestion task to llmcore API: {api_error}", exc_info=True)
            return jsonify({
                "error": f"Failed to submit ingestion task: {str(api_error)}"
            }), 500

    except Exception as e:
        logger.error(f"Unexpected error in ingestion route: {e}", exc_info=True)
        return jsonify({
            "error": f"Internal server error: {str(e)}"
        }), 500


@ingest_bp.route("/task/<task_id>/status", methods=["GET"])
@async_to_sync_in_flask
async def get_ingestion_task_status(task_id: str) -> Response:
    """
    Get the status of an ingestion task by forwarding the request to llmcore API.

    Args:
        task_id: The unique identifier of the ingestion task

    Returns:
        JSON response with task status information
    """
    try:
        api_client = get_api_client()
        status_data = await api_client.get_task_status(task_id)

        logger.debug(f"Retrieved status for ingestion task {task_id}: {status_data.get('status')}")
        return jsonify(status_data)

    except Exception as e:
        logger.error(f"Error getting status for ingestion task {task_id}: {e}", exc_info=True)
        return jsonify({
            "error": f"Failed to get task status: {str(e)}"
        }), 500


@ingest_bp.route("/task/<task_id>/result", methods=["GET"])
@async_to_sync_in_flask
async def get_ingestion_task_result(task_id: str) -> Response:
    """
    Get the result of a completed ingestion task by forwarding the request to llmcore API.

    Args:
        task_id: The unique identifier of the ingestion task

    Returns:
        JSON response with task result information
    """
    try:
        api_client = get_api_client()
        result_data = await api_client.get_task_result(task_id)

        logger.info(f"Retrieved result for completed ingestion task {task_id}")
        return jsonify(result_data)

    except Exception as e:
        logger.error(f"Error getting result for ingestion task {task_id}: {e}", exc_info=True)
        return jsonify({
            "error": f"Failed to get task result: {str(e)}"
        }), 500


logger.info("Data ingestion routes (/api/ingest) defined on ingest_bp with API proxy functionality.")
