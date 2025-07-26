# llmchat_web/routes/session_routes.py
"""
Flask routes for session management in the llmchat-web application.

This module provides API proxy endpoints that communicate with the llmcore service
to manage session lifecycle (create, list, load, delete, rename).
"""
import logging
import uuid
from typing import Any, Dict

from flask import jsonify, request
from flask import session as flask_session

from . import session_bp
from ..app import (
    async_to_sync_in_flask,
    get_current_web_session_id,
    set_current_web_session_id,
    logger as app_logger
)
from ..services import get_api_client

logger = logging.getLogger("llmchat_web.routes.session")
if not logger.handlers and app_logger:
    logger.parent = logging.getLogger("llmchat_web.routes")
    if logger.parent and logger.parent.level:
        logger.setLevel(logger.parent.level)
    else:
        logger.setLevel(app_logger.level if app_logger else logging.DEBUG)


@session_bp.route("", methods=["GET"])
@async_to_sync_in_flask
async def list_sessions_route() -> Any:
    """
    Lists all available LLMCore sessions by proxying to the llmcore API.

    Returns:
        JSON response with list of session metadata
    """
    logger.info("Session listing requested - calling llmcore API")
    try:
        api_client = get_api_client()
        sessions = await api_client.list_sessions()
        logger.info(f"Retrieved {len(sessions)} sessions from llmcore API")
        return jsonify(sessions)
    except Exception as e:
        logger.error(f"Error fetching sessions from llmcore API: {e}", exc_info=True)
        return jsonify({"error": f"Failed to fetch sessions: {str(e)}"}), 500


@session_bp.route("/new", methods=["POST"])
@async_to_sync_in_flask
async def new_session_route() -> Any:
    """
    Creates a new session via the llmcore API and updates Flask session state.

    Returns:
        JSON response with new session data
    """
    logger.info("New session creation requested")
    try:
        api_client = get_api_client()

        # Get optional system message from request
        request_data = request.get_json() or {}
        initial_system_message = request_data.get('system_message')

        # Create new session via API
        new_session_data = await api_client.create_session(initial_system_message)
        logger.info(f"Created new session via llmcore API: {new_session_data.get('id')}")

        # Update Flask session with the new session ID
        set_current_web_session_id(new_session_data.get('id'))

        # Reset Flask session variables to defaults
        flask_session['rag_enabled'] = False
        flask_session['rag_collection_name'] = None
        flask_session['rag_k_value'] = 3
        flask_session['rag_filter'] = None
        flask_session['current_provider_name'] = None
        flask_session['current_model_name'] = None
        flask_session['system_message'] = initial_system_message or ""
        flask_session['prompt_template_values'] = {}
        flask_session.modified = True

        logger.info(f"Flask session state reset for new session: {new_session_data.get('id')}")

        # Return the session data from llmcore API
        return jsonify(new_session_data), 201

    except Exception as e:
        logger.error(f"Error creating new session: {e}", exc_info=True)
        return jsonify({"error": f"Failed to create new session: {str(e)}"}), 500


@session_bp.route("/<session_id_to_load>/load", methods=["GET"])
@async_to_sync_in_flask
async def load_session_route(session_id_to_load: str) -> Any:
    """
    Loads an existing LLMCore session by its ID and updates Flask session state.

    Args:
        session_id_to_load: The ID of the session to load

    Returns:
        JSON response with session data and applied settings
    """
    logger.info(f"Session load requested for ID: {session_id_to_load}")
    try:
        api_client = get_api_client()

        # Get full session data from llmcore API
        session_data = await api_client.get_session(session_id_to_load)
        logger.info(f"Retrieved session data from llmcore API for session: {session_id_to_load}")

        # Update Flask session with the loaded session's ID
        set_current_web_session_id(session_data.get('id'))

        # Extract and apply session settings to Flask session
        # Note: The exact structure of session_data depends on llmcore API response format
        # This implementation assumes reasonable defaults if specific fields are missing

        settings = session_data.get('settings', {})
        flask_session['rag_enabled'] = settings.get('rag_enabled', False)
        flask_session['rag_collection_name'] = settings.get('rag_collection_name')
        flask_session['rag_k_value'] = settings.get('rag_k_value', 3)
        flask_session['rag_filter'] = settings.get('rag_filter')
        flask_session['current_provider_name'] = settings.get('provider_name')
        flask_session['current_model_name'] = settings.get('model_name')
        flask_session['system_message'] = settings.get('system_message', "")
        flask_session['prompt_template_values'] = settings.get('prompt_template_values', {})
        flask_session.modified = True

        logger.info(f"Flask session state updated for loaded session: {session_id_to_load}")

        # Prepare response with session data and applied settings for UI sync
        response_payload = {
            "session_data": session_data,
            "applied_settings": {
                "rag_enabled": flask_session['rag_enabled'],
                "rag_collection_name": flask_session['rag_collection_name'],
                "k_value": flask_session['rag_k_value'],
                "rag_filter": flask_session['rag_filter'],
                "current_provider_name": flask_session['current_provider_name'],
                "current_model_name": flask_session['current_model_name'],
                "system_message": flask_session['system_message'],
                "prompt_template_values": flask_session['prompt_template_values']
            },
            "context_usage": session_data.get('context_usage'),  # May be null
            "message": "Session loaded successfully"
        }

        return jsonify(response_payload)

    except Exception as e:
        logger.error(f"Error loading session {session_id_to_load}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to load session: {str(e)}"}), 500


@session_bp.route("/<session_id_to_delete>", methods=["DELETE"])
@async_to_sync_in_flask
async def delete_session_route(session_id_to_delete: str) -> Any:
    """
    Deletes an LLMCore session by its ID via the llmcore API.

    Args:
        session_id_to_delete: The ID of the session to delete

    Returns:
        JSON response confirming deletion
    """
    logger.info(f"Session deletion requested for ID: {session_id_to_delete}")
    try:
        api_client = get_api_client()

        # Delete the session via llmcore API
        await api_client.delete_session(session_id_to_delete)
        logger.info(f"Successfully deleted session via llmcore API: {session_id_to_delete}")

        # If the deleted session was the active one, clear the Flask session ID
        if get_current_web_session_id() == session_id_to_delete:
            set_current_web_session_id(None)
            logger.info(f"Cleared active session ID from Flask session: {session_id_to_delete}")

        return jsonify({"message": "Session deleted successfully."})

    except Exception as e:
        logger.error(f"Error deleting session {session_id_to_delete}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to delete session: {str(e)}"}), 500


@session_bp.route("/<session_id>/rename", methods=["POST"])
@async_to_sync_in_flask
async def rename_session_route(session_id: str) -> Any:
    """
    Renames a persistent session in LLMCore via the llmcore API.

    Args:
        session_id: The ID of the session to rename

    Returns:
        JSON response with updated session data
    """
    logger.info(f"Session rename requested for ID: {session_id}")
    try:
        # Get the new name from request JSON
        request_data = request.get_json()
        if not request_data or 'new_name' not in request_data:
            return jsonify({"error": "Missing 'new_name' in request body"}), 400

        new_name = request_data['new_name']
        if not new_name or not new_name.strip():
            return jsonify({"error": "New name cannot be empty"}), 400

        api_client = get_api_client()

        # Rename the session via llmcore API
        renamed_session = await api_client.rename_session(session_id, new_name.strip())
        logger.info(f"Successfully renamed session via llmcore API: {session_id} -> '{new_name.strip()}'")

        return jsonify(renamed_session)

    except Exception as e:
        logger.error(f"Error renaming session {session_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to rename session: {str(e)}"}), 500


@session_bp.route("/<session_id>/messages/<message_id>", methods=["DELETE"])
@async_to_sync_in_flask
async def delete_message_from_session_route(session_id: str, message_id: str) -> Any:
    """
    Deletes a specific message from a given LLMCore session.
    Currently not implemented in llmcore API - returns 501 Not Implemented.
    """
    logger.info(f"Message deletion requested for session {session_id}, message {message_id} - not yet implemented")
    return jsonify({"error": "Message deletion not yet implemented - LLMCore API endpoint pending"}), 501


@session_bp.route("/<session_id>/metadata", methods=["POST"])
@async_to_sync_in_flask
async def update_session_metadata_route(session_id: str) -> Any:
    """
    Updates client-specific metadata for a persistent session.
    Currently not implemented in llmcore API - returns 501 Not Implemented.
    """
    logger.info(f"Session metadata update requested for ID: {session_id} - not yet implemented")
    return jsonify({"error": "Session metadata updates not yet implemented - LLMCore API endpoint pending"}), 501


logger.info("Session management routes defined on session_bp with llmcore API integration.")
