# llmchat_web/routes/workspace_routes.py
"""
Flask routes for workspace and context management in the llmchat-web application.
Handles operations on session-specific workspace items (context pool)
and context preview functionalities.

REFACTORED: All operations now use the LLMCoreAPIClient service instead of
direct llmcore library imports. This completes the architectural decoupling
required by Phase 1 of the service-oriented architecture transition.
"""
import logging
from typing import Any, Dict, List, Optional

from flask import jsonify, request
from flask import session as flask_session

# Import the specific blueprint defined in the routes package's __init__.py
from . import workspace_bp

# --- Rationale Block: API-Driven Architecture Transition ---
# Pre-state: Routes directly imported and used llmcore_instance, LLMCore exceptions,
#            and models. Complex logic for resolving staged items and enriching
#            responses was handled in the web layer.
# Limitation: Tight coupling prevented independent deployment and scaling, violated
#             service-oriented architecture principles, and required full llmcore
#             library dependency in the web service.
# Decision Path: Replace all direct llmcore interactions with HTTP API calls via
#                LLMCoreAPIClient. Move complex business logic (staged item resolution,
#                context enrichment) to the llmcore service where it belongs.
# Post-state: Routes act as pure API proxies, enabling true service decoupling
#             and completing Phase 1 architectural goals.

from ..app import (
    async_to_sync_in_flask,
    logger as app_logger,  # Main app logger
)

# Replace llmcore direct imports with API client
from ..services.llmcore_api_client import get_api_client

# Configure a local logger for this specific routes module
logger = logging.getLogger("llmchat_web.routes.workspace")
if not logger.handlers and app_logger:
    logger.parent = logging.getLogger("llmchat_web.routes")
    if logger.parent and logger.parent.level:
        logger.setLevel(logger.parent.level)
    else:
        logger.setLevel(app_logger.level if app_logger else logging.DEBUG)


# --- Workspace (Session Context Item) Management API Endpoints ---
# workspace_bp has url_prefix='/api/sessions'.
# Routes here will be e.g., /api/sessions/<session_id>/workspace/items


@workspace_bp.route("/<session_id>/workspace/items", methods=["GET"])
@async_to_sync_in_flask
async def list_workspace_items_route(session_id: str) -> Any:
    """
    Lists all workspace items (LLMCore ContextItems) for a given session.
    """
    api_client = get_api_client()

    try:
        logger.debug(f"Listing workspace items for session: {session_id}")
        items = await api_client.list_workspace_items(session_id)
        logger.info(f"Successfully listed {len(items)} workspace items for session {session_id}.")
        return jsonify(items)
    except Exception as e:
        # Handle different HTTP status codes from the API
        if hasattr(e, 'response') and hasattr(e.response, 'status_code'):
            if e.response.status_code == 404:
                logger.warning(f"Session {session_id} not found when listing workspace items.")
                return jsonify({"error": "Session not found."}), 404
            elif e.response.status_code == 503:
                logger.error(f"LLMCore service unavailable when listing workspace items for session {session_id}.")
                return jsonify({"error": "LLM service not available."}), 503

        logger.error(f"Error listing workspace items for session {session_id}: {e}", exc_info=True)
        return jsonify({"error": "Failed to list workspace items."}), 500


@workspace_bp.route("/<session_id>/workspace/items/<item_id>", methods=["GET"])
@async_to_sync_in_flask
async def get_workspace_item_route(session_id: str, item_id: str) -> Any:
    """
    Retrieves a specific workspace item by its ID from a given session.
    """
    api_client = get_api_client()

    try:
        logger.debug(f"Getting workspace item '{item_id}' for session: {session_id}")
        item = await api_client.get_workspace_item(session_id, item_id)
        logger.info(f"Successfully retrieved workspace item '{item_id}' for session {session_id}.")
        return jsonify(item)
    except Exception as e:
        # Handle different HTTP status codes from the API
        if hasattr(e, 'response') and hasattr(e.response, 'status_code'):
            if e.response.status_code == 404:
                # Could be session not found or item not found
                logger.warning(f"Session {session_id} or workspace item '{item_id}' not found.")
                return jsonify({"error": "Session or workspace item not found."}), 404
            elif e.response.status_code == 503:
                logger.error(f"LLMCore service unavailable when getting workspace item {item_id} for session {session_id}.")
                return jsonify({"error": "LLM service not available."}), 503

        logger.error(f"Error getting workspace item {item_id} for session {session_id}: {e}", exc_info=True)
        return jsonify({"error": "Failed to get workspace item."}), 500


@workspace_bp.route("/<session_id>/workspace/add_text", methods=["POST"])
@async_to_sync_in_flask
async def add_text_to_workspace_route(session_id: str) -> Any:
    """
    Adds a text snippet as a new workspace item to the specified session.
    Expects JSON payload: {"content": "your text", "item_id": "optional_custom_id"}
    """
    api_client = get_api_client()

    data = request.json
    if not data or "content" not in data:
        logger.warning(f"Add text to workspace for session {session_id} called without 'content' in payload.")
        return jsonify({"error": "Missing 'content' in request payload."}), 400

    try:
        logger.debug(f"Adding text to workspace for session {session_id}. Custom ID: {data.get('item_id')}")
        added_item = await api_client.add_text_to_workspace(session_id, payload=data)
        logger.info(f"Successfully added text item to workspace for session {session_id}.")
        return jsonify(added_item), 201  # 201 Created
    except Exception as e:
        # Handle different HTTP status codes from the API
        if hasattr(e, 'response') and hasattr(e.response, 'status_code'):
            if e.response.status_code == 404:
                logger.warning(f"Session {session_id} not found when adding text to workspace.")
                return jsonify({"error": "Session not found."}), 404
            elif e.response.status_code == 503:
                logger.error(f"LLMCore service unavailable when adding text to workspace for session {session_id}.")
                return jsonify({"error": "LLM service not available."}), 503

        logger.error(f"Error adding text to workspace for session {session_id}: {e}", exc_info=True)
        return jsonify({"error": "Failed to add text to workspace."}), 500


@workspace_bp.route("/<session_id>/workspace/add_file", methods=["POST"])
@async_to_sync_in_flask
async def add_file_to_workspace_route(session_id: str) -> Any:
    """
    Adds a server-side file's content as a new workspace item to the specified session.
    Expects JSON payload: {"file_path": "/path/to/file_on_server", "item_id": "optional_custom_id"}
    """
    api_client = get_api_client()

    data = request.json
    if not data or "file_path" not in data:
        logger.warning(f"Add file to workspace for session {session_id} called without 'file_path' in payload.")
        return jsonify({"error": "Missing 'file_path' in request payload."}), 400

    try:
        logger.debug(f"Adding file '{data['file_path']}' to workspace for session {session_id}. Custom ID: {data.get('item_id')}")
        added_item = await api_client.add_file_to_workspace(session_id, payload=data)
        logger.info(f"Successfully added file item to workspace for session {session_id}.")
        return jsonify(added_item), 201  # 201 Created
    except Exception as e:
        # Handle different HTTP status codes from the API
        if hasattr(e, 'response') and hasattr(e.response, 'status_code'):
            if e.response.status_code == 404:
                # Could be session not found or file not found
                logger.warning(f"Session {session_id} not found or file not found when adding file to workspace.")
                return jsonify({"error": "Session or file not found."}), 404
            elif e.response.status_code == 503:
                logger.error(f"LLMCore service unavailable when adding file to workspace for session {session_id}.")
                return jsonify({"error": "LLM service not available."}), 503

        logger.error(f"Error adding file to workspace for session {session_id}: {e}", exc_info=True)
        return jsonify({"error": "Failed to add file to workspace."}), 500


@workspace_bp.route("/<session_id>/workspace/items/<item_id>", methods=["DELETE"])
@async_to_sync_in_flask
async def remove_workspace_item_route(session_id: str, item_id: str) -> Any:
    """
    Removes a workspace item by its ID from the specified session.
    """
    api_client = get_api_client()

    try:
        logger.info(f"Attempting to remove workspace item '{item_id}' from session '{session_id}'.")
        await api_client.remove_workspace_item(session_id, item_id)
        logger.info(f"Successfully removed workspace item '{item_id}' from session '{session_id}'.")
        return jsonify({"message": f"Workspace item '{item_id}' removed successfully."})
    except Exception as e:
        # Handle different HTTP status codes from the API
        if hasattr(e, 'response') and hasattr(e.response, 'status_code'):
            if e.response.status_code == 404:
                logger.warning(f"Session {session_id} or workspace item '{item_id}' not found for removal.")
                return jsonify({"error": "Session or workspace item not found."}), 404
            elif e.response.status_code == 503:
                logger.error(f"LLMCore service unavailable when removing workspace item {item_id} for session {session_id}.")
                return jsonify({"error": "LLM service not available."}), 503

        logger.error(f"Error removing workspace item {item_id} for session {session_id}: {e}", exc_info=True)
        return jsonify({"error": "Failed to remove workspace item."}), 500


@workspace_bp.route("/<session_id>/workspace/add_from_message", methods=["POST"])
@async_to_sync_in_flask
async def add_message_to_workspace_route(session_id: str) -> Any:
    """
    Adds content of a specific message from the session's history to its workspace items.
    Expects JSON payload: {"message_id": "id_of_message_to_add"}

    SIMPLIFIED: Complex logic for loading sessions and finding messages is now
    handled entirely by the llmcore service. This route simply passes the
    message_id to the API endpoint.
    """
    api_client = get_api_client()

    data = request.json
    if not data or "message_id" not in data:
        logger.warning(f"Add message to workspace for session {session_id} called without 'message_id' in payload.")
        return jsonify({"error": "Missing 'message_id' in request payload."}), 400

    try:
        logger.debug(f"Attempting to add message '{data['message_id']}' to workspace for session '{session_id}'.")
        added_item = await api_client.add_message_to_workspace(session_id, payload=data)
        logger.info(f"Successfully added message to workspace for session {session_id}.")
        return jsonify(added_item), 201  # 201 Created
    except Exception as e:
        # Handle different HTTP status codes from the API
        if hasattr(e, 'response') and hasattr(e.response, 'status_code'):
            if e.response.status_code == 404:
                logger.warning(f"Session {session_id} or message not found when adding message to workspace.")
                return jsonify({"error": "Session or message not found."}), 404
            elif e.response.status_code == 503:
                logger.error(f"LLMCore service unavailable when adding message to workspace for session {session_id}.")
                return jsonify({"error": "LLM service not available."}), 503

        logger.error(f"Error adding message to workspace for session {session_id}: {e}", exc_info=True)
        return jsonify({"error": "Failed to add message to workspace."}), 500


# --- Context Preview API Endpoint ---
# This route is /api/sessions/<session_id>/context/preview
@workspace_bp.route("/<session_id>/context/preview", methods=["POST"])
@async_to_sync_in_flask
async def preview_context_route(session_id: str) -> Any:
    """
    Previews the full context that LLMCore would prepare for a chat interaction.
    This includes message history, RAG documents (if enabled), and explicitly staged items.

    SIMPLIFIED: The complex logic for resolving staged items and enriching responses
    with provider/model names is now handled entirely by the llmcore service.
    This route constructs the preview request payload from Flask session data
    and passes it to the API endpoint.

    Expects JSON payload:
    {
        "current_query": "Optional: The user's next query text for more accurate preview.",
        "staged_items": "Optional: Array of client-side staged items to include in preview."
    }
    """
    api_client = get_api_client()

    data = request.json
    current_query_for_preview: Optional[str] = data.get("current_query") if data else None
    staged_items_from_js: List[Dict[str, Any]] = data.get("staged_items", []) if data else []

    logger.debug(f"Previewing context for session {session_id}. Query: '{current_query_for_preview}'. Staged items from JS: {len(staged_items_from_js)}")

    try:
        # Build the complete payload with all necessary context from Flask session
        # The llmcore service will handle resolving staged items and providing complete context details
        preview_payload = {
            "current_query": current_query_for_preview or "",
            "staged_items": staged_items_from_js,
            # Include current LLM and RAG settings from Flask session
            "system_message": flask_session.get("system_message"),
            "provider_name": flask_session.get("current_provider_name"),
            "model_name": flask_session.get("current_model_name"),
            "enable_rag": flask_session.get("rag_enabled", False),
            "rag_collection_name": flask_session.get("rag_collection_name"),
            "rag_retrieval_k": flask_session.get("rag_k_value"),
            "rag_metadata_filter": flask_session.get("rag_filter"),
            "prompt_template_values": flask_session.get("prompt_template_values", {}),
        }

        preview_details = await api_client.preview_context(session_id, payload=preview_payload)
        logger.info(f"Successfully generated context preview for session {session_id}.")
        return jsonify(preview_details)
    except Exception as e:
        # Handle different HTTP status codes from the API
        if hasattr(e, 'response') and hasattr(e.response, 'status_code'):
            if e.response.status_code == 404:
                logger.warning(f"Session {session_id} not found when generating context preview.")
                return jsonify({"error": "Session not found."}), 404
            elif e.response.status_code == 503:
                logger.error(f"LLMCore service unavailable when generating context preview for session {session_id}.")
                return jsonify({"error": "LLM service not available."}), 503

        logger.error(f"Error generating context preview for session {session_id}: {e}", exc_info=True)
        return jsonify({"error": "Failed to generate context preview."}), 500


logger.info("Workspace and context management routes defined on workspace_bp (API-driven implementation).")
