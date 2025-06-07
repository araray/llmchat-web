# llmchat_web/routes/session_routes.py
"""
Flask routes for session management in the llmchat-web application.
Handles listing, creating, loading, and deleting chat sessions,
as well as operations on messages within sessions.
It also includes an endpoint for updating client-specific session metadata.
"""
import logging
import uuid # For generating new session IDs
from typing import Any, Optional, Dict

from flask import jsonify, request
from flask import session as flask_session

# Import the specific blueprint defined in the routes package's __init__.py
from . import session_bp

# Import shared components from the main app module (llmchat_web.app)
from ..app import (
    llmcore_instance,
    async_to_sync_in_flask,
    get_context_usage_info, # Import the helper function
    get_current_web_session_id,
    set_current_web_session_id,
    logger as app_logger # Main app logger
)

# Import specific LLMCore exceptions and models relevant to sessions
from llmcore import (
    LLMCoreError, SessionNotFoundError,
    ChatSession as LLMCoreChatSession,
    Role as LLMCoreRole
)

# Configure a local logger for this specific routes module
logger = logging.getLogger("llmchat_web.routes.session")
if not logger.handlers and app_logger: # Ensure handlers are not added multiple times
    logger.parent = logging.getLogger("llmchat_web.routes") # Set parent to the routes package logger
    if logger.parent and logger.parent.level: # Check if parent logger has a level set
        logger.setLevel(logger.parent.level)
    else: # Fallback if parent logger isn't fully set up
        logger.setLevel(app_logger.level if app_logger else logging.DEBUG)


# --- Session Management API Endpoints ---

@session_bp.route("", methods=["GET"])
@async_to_sync_in_flask
async def list_sessions_route() -> Any:
    """
    Lists all available LLMCore sessions.
    Retrieves session metadata (ID, name, updated_at, message_count, context_item_count) from LLMCore.
    """
    if not llmcore_instance:
        logger.error("Attempted to list sessions, but LLM service (llmcore_instance) is not available.")
        return jsonify({"error": "LLM service not available."}), 503
    try:
        sessions = await llmcore_instance.list_sessions() # Returns List[Dict[str, Any]]
        logger.info(f"Successfully listed {len(sessions)} sessions.")
        return jsonify(sessions)
    except LLMCoreError as e:
        logger.error(f"Error listing sessions: {e}", exc_info=True)
        return jsonify({"error": f"Failed to list sessions: {str(e)}"}), 500
    except Exception as e_unexp:
        logger.error(f"Unexpected error listing sessions: {e_unexp}", exc_info=True)
        return jsonify({"error": "An unexpected server error occurred while listing sessions."}), 500


@session_bp.route("/new", methods=["POST"])
@async_to_sync_in_flask
async def new_session_route() -> Any:
    """
    Initializes a new session context in the Flask web session.
    Generates a new potential LLMCore session ID and resets relevant Flask session
    variables (RAG settings, LLM provider/model, system message, prompt template values)
    to their defaults, typically derived from LLMCore's application configuration.
    An actual persistent LLMCore session is created by LLMCore on the first chat message if `save_session=True`.
    """
    if not llmcore_instance:
        logger.error("Attempted to create new session context, but LLM service is not available.")
        return jsonify({"error": "LLM service not available."}), 503
    try:
        new_llmcore_session_id = f"web_session_{uuid.uuid4().hex}"
        set_current_web_session_id(new_llmcore_session_id)
        logger.info(f"New web session context initiated. Potential LLMCore ID for next persistent session: {new_llmcore_session_id}.")


        llmcore_cfg = llmcore_instance.config

        # Reset Flask session variables to LLMCore application defaults
        flask_session['rag_enabled'] = llmcore_cfg.get("context_management.rag_enabled_default", False) # Example new config key
        flask_session['rag_collection_name'] = llmcore_cfg.get("storage.vector.default_collection")
        flask_session['rag_k_value'] = llmcore_cfg.get("context_management.rag_retrieval_k", 3)
        flask_session['rag_filter'] = None # Always reset filter to None for a new session context

        default_provider = llmcore_cfg.get("llmcore.default_provider")
        flask_session['current_provider_name'] = default_provider
        logger.debug(f"New session: Flask session 'current_provider_name' reset to app default: {default_provider}")

        default_model_for_provider = None
        if default_provider and llmcore_cfg.get(f"providers.{default_provider}"): # Check provider section exists
            default_model_for_provider = llmcore_cfg.get(f"providers.{default_provider}.default_model")
        flask_session['current_model_name'] = default_model_for_provider
        logger.debug(f"New session: Flask session 'current_model_name' reset to provider default: {default_model_for_provider}")

        # Reset system message to empty or a global default if one exists in config
        flask_session['system_message'] = llmcore_cfg.get("llmcore.default_system_message", "")
        logger.debug(f"New session: Flask session 'system_message' reset to: '{flask_session['system_message'][:50]}...'")

        flask_session['prompt_template_values'] = {} # Reset to empty
        logger.debug("New session: Flask session 'prompt_template_values' reset to empty dict.")

        flask_session.modified = True # Ensure session changes are saved

        response_payload: Dict[str, Any] = {
            "id": new_llmcore_session_id, # This is the ID for the potential LLMCore session
            "name": None, # LLMCore session name is not set yet
            "messages": [], # No messages in a new session context
            "rag_settings": {
                "enabled": flask_session['rag_enabled'],
                "collection_name": flask_session['rag_collection_name'],
                "k_value": flask_session['rag_k_value'],
                "filter": flask_session['rag_filter'],
            },
            "llm_settings": {
                "provider_name": flask_session['current_provider_name'],
                "model_name": flask_session['current_model_name'],
                "system_message": flask_session['system_message'],
            },
            "prompt_template_values": flask_session['prompt_template_values'],
        }
        # This endpoint returns the state of the *Flask session* after reset,
        # which prepares for a new LLMCore session.
        return jsonify(response_payload), 201
    except LLMCoreError as e: # Catch broad LLMCore errors if config access fails
        logger.error(f"Error creating new session context: {e}", exc_info=True)
        return jsonify({"error": f"Failed to initialize new session context: {str(e)}"}), 500
    except Exception as e_unexp:
        logger.error(f"Unexpected error creating new session context: {e_unexp}", exc_info=True)
        return jsonify({"error": "An unexpected server error occurred while creating new session context."}), 500


@session_bp.route("/<session_id_to_load>/load", methods=["GET"])
@async_to_sync_in_flask
async def load_session_route(session_id_to_load: str) -> Any:
    """
    Loads an existing LLMCore session by its ID.
    Retrieves the session's data, updates Flask session settings based on
    the session's metadata, and includes the last known context usage info.
    """
    if not llmcore_instance:
        logger.error(f"Attempted to load session {session_id_to_load}, but LLM service is not available.")
        return jsonify({"error": "LLM service not available."}), 503
    try:
        logger.info(f"Attempting to load LLMCore session: {session_id_to_load}")
        session_obj: Optional[LLMCoreChatSession] = await llmcore_instance.get_session(session_id_to_load)

        if not session_obj:
             logger.warning(f"LLMCore session ID '{session_id_to_load}' not found by llmcore_instance.get_session.")
             return jsonify({"error": "Session not found by LLMCore."}), 404

        set_current_web_session_id(session_obj.id)
        logger.debug(f"Load session: Set Flask current_llm_session_id to '{session_obj.id}'.")

        session_metadata = session_obj.metadata or {}
        llmcore_cfg = llmcore_instance.config
        logger.debug(f"Load session: LLMCore session '{session_id_to_load}' metadata loaded: {session_metadata}")

        # Update Flask session with settings from loaded LLMCore session metadata or app defaults
        flask_session['current_provider_name'] = session_metadata.get('current_provider_name', llmcore_cfg.get("llmcore.default_provider"))
        if 'current_model_name' in session_metadata:
            flask_session['current_model_name'] = session_metadata['current_model_name']
        else:
            provider_for_model_fallback = flask_session['current_provider_name']
            default_model_for_provider = None
            if provider_for_model_fallback and llmcore_cfg.get(f"providers.{provider_for_model_fallback}"):
                default_model_for_provider = llmcore_cfg.get(f"providers.{provider_for_model_fallback}.default_model")
            flask_session['current_model_name'] = default_model_for_provider
        logger.info(f"Load session: Flask session provider set to '{flask_session['current_provider_name']}', model to '{flask_session['current_model_name']}'.")

        flask_session['system_message'] = session_metadata.get('system_message', llmcore_cfg.get("llmcore.default_system_message", ""))
        flask_session['rag_enabled'] = session_metadata.get('rag_enabled', llmcore_cfg.get("context_management.rag_enabled_default", False))
        flask_session['rag_collection_name'] = session_metadata.get('rag_collection_name', llmcore_cfg.get("storage.vector.default_collection"))
        flask_session['rag_k_value'] = session_metadata.get('rag_k_value', llmcore_cfg.get("context_management.rag_retrieval_k", 3))
        flask_session['rag_filter'] = session_metadata.get('rag_filter', None)
        flask_session['prompt_template_values'] = session_metadata.get('prompt_template_values', {})

        flask_session.modified = True

        logger.info(f"Successfully loaded LLMCore session {session_obj.id}. Flask session settings updated.")

        # Fetch context usage info for the loaded session
        context_usage_val = await get_context_usage_info(session_id_to_load)

        response_payload: Dict[str, Any] = {
            "session_data": session_obj.model_dump(mode="json"),
            "applied_settings": {
                "rag_enabled": flask_session['rag_enabled'],
                "rag_collection_name": flask_session['rag_collection_name'],
                "k_value": flask_session['rag_k_value'],
                "rag_filter": flask_session['rag_filter'],
                "current_provider_name": flask_session['current_provider_name'],
                "current_model_name": flask_session['current_model_name'],
                "system_message": flask_session['system_message'],
                "prompt_template_values": flask_session['prompt_template_values'],
            },
            "context_usage": context_usage_val, # Add the context usage to the payload
        }
        return jsonify(response_payload)
    except SessionNotFoundError:
        logger.warning(f"LLMCore session {session_id_to_load} not found by LLMCore during load (SessionNotFoundError).")
        return jsonify({"error": "Session not found."}), 404
    except LLMCoreError as e:
        logger.error(f"Error loading LLMCore session {session_id_to_load}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to load session: {str(e)}"}), 500
    except Exception as e_unexp:
        logger.error(f"Unexpected error loading LLMCore session {session_id_to_load}: {e_unexp}", exc_info=True)
        return jsonify({"error": "An unexpected server error occurred while loading the session."}), 500


@session_bp.route("/<session_id_to_delete>", methods=["DELETE"])
@async_to_sync_in_flask
async def delete_session_route(session_id_to_delete: str) -> Any:
    """
    Deletes an LLMCore session by its ID.
    If the deleted session was the currently active web session,
    the current web session ID in Flask session is cleared.
    """
    if not llmcore_instance:
        logger.error(f"Attempted to delete session {session_id_to_delete}, but LLM service is not available.")
        return jsonify({"error": "LLM service not available."}), 503
    try:
        logger.info(f"Attempting to delete session: {session_id_to_delete}")
        deleted = await llmcore_instance.delete_session(session_id_to_delete)
        if deleted:
            logger.info(f"Successfully deleted session {session_id_to_delete} from LLMCore.")
            if get_current_web_session_id() == session_id_to_delete:
                set_current_web_session_id(None)
                flask_session.modified = True
                logger.info(f"Cleared deleted session {session_id_to_delete} from current Flask session ID.")
            return jsonify({"message": f"Session '{session_id_to_delete}' deleted successfully."})
        else:
            logger.warning(f"Session {session_id_to_delete} not found by LLMCore for deletion, or already non-existent.")
            return jsonify({"error": "Session not found or could not be deleted by LLMCore."}), 404
    except LLMCoreError as e:
        logger.error(f"Error deleting session {session_id_to_delete}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to delete session: {str(e)}"}), 500
    except Exception as e_unexp:
        logger.error(f"Unexpected error deleting session {session_id_to_delete}: {e_unexp}", exc_info=True)
        return jsonify({"error": "An unexpected server error occurred while deleting the session."}), 500


@session_bp.route("/<session_id>/messages/<message_id>", methods=["DELETE"])
@async_to_sync_in_flask
async def delete_message_from_session_route(session_id: str, message_id: str) -> Any:
    """
    Deletes a specific message from a given LLMCore session.
    """
    if not llmcore_instance:
        logger.error(f"Attempted to delete message {message_id} from session {session_id}, but LLM service is not available.")
        return jsonify({"error": "LLM service not available."}), 503
    try:
        logger.info(f"Attempting to delete message '{message_id}' from session '{session_id}'.")
        success = await llmcore_instance.delete_message_from_session(session_id, message_id)
        if success:
            logger.info(f"Successfully deleted message '{message_id}' from session '{session_id}'.")
            return jsonify({"message": f"Message '{message_id}' deleted from session '{session_id}'."})
        else:
            logger.warning(f"Message '{message_id}' not found in session '{session_id}' or could not be deleted by LLMCore.")
            return jsonify({"error": "Message not found in session or could not be deleted."}), 404
    except SessionNotFoundError:
        logger.warning(f"Session '{session_id}' not found when trying to delete message '{message_id}'.")
        return jsonify({"error": f"Session '{session_id}' not found."}), 404
    except LLMCoreError as e:
        logger.error(f"Error deleting message {message_id} from session {session_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to delete message: {str(e)}"}), 500
    except Exception as e_unexp:
        logger.error(f"Unexpected error deleting message {message_id} from session {session_id}: {e_unexp}", exc_info=True)
        return jsonify({"error": "An unexpected server error occurred while deleting the message."}), 500


@session_bp.route("/<session_id>/metadata", methods=["POST"])
@async_to_sync_in_flask
async def update_session_metadata_route(session_id: str) -> Any:
    """
    Updates a client-specific key in a persistent session's metadata.
    This allows a client application (like the web UI) to store its
    own state within the session object.

    Expects JSON payload: `{"client_data": {...}, "client_key": "optional_key_name"}`
    """
    if not llmcore_instance:
        logger.error(f"Attempted to update metadata for session {session_id}, but LLM service is not available.")
        return jsonify({"error": "LLM service not available."}), 503

    data = request.json
    if not data or "client_data" not in data:
        logger.warning(f"Update session metadata for {session_id} called without 'client_data' in payload.")
        return jsonify({"error": "Missing 'client_data' in request payload."}), 400

    client_data = data["client_data"]
    client_key = data.get("client_key", "client_data")

    try:
        logger.info(f"Updating metadata for session '{session_id}' with key '{client_key}'.")
        success = await llmcore_instance.update_session_metadata(
            session_id=session_id,
            client_metadata=client_data,
            client_key=client_key
        )

        if success:
            logger.info(f"Successfully updated metadata for session '{session_id}'.")
            return jsonify({"message": f"Metadata for session '{session_id}' updated successfully."})
        else:
            logger.warning(f"Failed to update metadata for session '{session_id}'. Session may not have been found.")
            return jsonify({"error": "Session not found or update failed."}), 404
    except SessionNotFoundError:
         logger.warning(f"Session '{session_id}' not found when updating metadata.")
         return jsonify({"error": "Session not found."}), 404
    except LLMCoreError as e:
        logger.error(f"LLMCore error updating metadata for session {session_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to update session metadata: {str(e)}"}), 500
    except Exception as e_unexp:
        logger.error(f"Unexpected error updating metadata for session {session_id}: {e_unexp}", exc_info=True)
        return jsonify({"error": "An unexpected server error occurred."}), 500


logger.info("Session management routes defined on session_bp.")
