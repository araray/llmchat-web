# llmchat_web/routes/session_routes.py
"""
Flask routes for session management in the llmchat-web application.
Handles listing, creating, loading, and deleting chat sessions,
as well as operations on messages within sessions.
"""
import logging
import uuid # For generating new session IDs
from typing import Any, Optional, Dict # Added Dict for type hinting

from flask import jsonify, request
from flask import session as flask_session

# Import the specific blueprint defined in the routes package's __init__.py
from . import session_bp

# Import shared components from the main app module (llmchat_web.app)
from ..app import (
    llmcore_instance,
    async_to_sync_in_flask,
    get_current_web_session_id,
    set_current_web_session_id,
    logger as app_logger # Main app logger
)

# Import specific LLMCore exceptions and models relevant to sessions
from llmcore import (
    LLMCoreError, SessionNotFoundError,
    ChatSession as LLMCoreChatSession, # May be used for type hinting or direct interaction
    Role as LLMCoreRole # For checking message roles if needed, though not directly in these routes
)

# Configure a local logger for this specific routes module
logger = logging.getLogger("llmchat_web.routes.session")
if not logger.handlers and app_logger:
    logger.parent = logging.getLogger("llmchat_web.routes")
    if logger.parent and logger.parent.level:
        logger.setLevel(logger.parent.level)
    else:
        logger.setLevel(app_logger.level if app_logger else logging.DEBUG)


# --- Session Management API Endpoints ---

# Note: session_bp has url_prefix='/api/sessions'.
# So, this route will be accessible at GET /api/sessions
@session_bp.route("", methods=["GET"]) # Empty path for the blueprint's root
@async_to_sync_in_flask
async def list_sessions_route() -> Any:
    """
    Lists all available LLMCore sessions.
    Retrieves session metadata from LLMCore.
    """
    if not llmcore_instance:
        logger.error("Attempted to list sessions, but LLM service (llmcore_instance) is not available.")
        return jsonify({"error": "LLM service not available."}), 503
    try:
        sessions = await llmcore_instance.list_sessions()
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
    It generates a new potential LLMCore session ID and resets relevant
    Flask session variables (RAG settings, LLM provider/model, system message,
    prompt template values) to their defaults based on LLMCore configuration.
    An actual LLMCore session is typically created persistently on the first chat message.
    """
    if not llmcore_instance:
        logger.error("Attempted to create new session context, but LLM service is not available.")
        return jsonify({"error": "LLM service not available."}), 503
    try:
        new_llmcore_session_id = f"web_session_{uuid.uuid4().hex}"
        set_current_web_session_id(new_llmcore_session_id) # Store in Flask session

        # Reset Flask session variables to defaults from LLMCore config or sensible fallbacks
        flask_session['rag_enabled'] = False
        flask_session['rag_collection_name'] = llmcore_instance.config.get("storage.vector.default_collection") if llmcore_instance.config else None
        flask_session['rag_k_value'] = llmcore_instance.config.get("context_management.rag_retrieval_k", 3) if llmcore_instance.config else 3
        flask_session['rag_filter'] = None
        flask_session['current_provider_name'] = llmcore_instance.config.get("llmcore.default_provider") if llmcore_instance.config else None

        if flask_session.get('current_provider_name') and llmcore_instance.config:
            flask_session['current_model_name'] = llmcore_instance.config.get(f"providers.{flask_session['current_provider_name']}.default_model")
        else:
            flask_session['current_model_name'] = None

        flask_session['system_message'] = "" # Default to empty
        flask_session['prompt_template_values'] = {} # Default to empty

        flask_session.modified = True # Ensure session is saved

        logger.info(f"New web session context initiated. Potential LLMCore ID: {new_llmcore_session_id}. Flask session RAG/LLM/Prompt settings reset to defaults.")

        # Return the new session ID and the settings that were applied to the Flask session
        response_payload: Dict[str, Any] = {
            "id": new_llmcore_session_id, # This is the ID for the *next* LLMCore session
            "name": None, # LLMCore session name is not set until first interaction
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
        return jsonify(response_payload), 201 # 201 Created (for the new session context)
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
    Sets the loaded session as the current session in the Flask web session.
    Retrieves the session's data (messages, metadata) from LLMCore and updates
    the Flask session's RAG/LLM settings based on the loaded session's metadata,
    falling back to defaults if metadata is missing.
    """
    if not llmcore_instance:
        logger.error(f"Attempted to load session {session_id_to_load}, but LLM service is not available.")
        return jsonify({"error": "LLM service not available."}), 503
    try:
        logger.info(f"Attempting to load session: {session_id_to_load}")
        session_obj: Optional[LLMCoreChatSession] = await llmcore_instance.get_session(session_id_to_load)

        # LLMCore's get_session might return a new, empty session if the ID doesn't exist
        # or if it's configured to do so. We need to ensure it's an existing session.
        # A more robust check: list sessions and see if this ID is present.
        all_sessions_meta = await llmcore_instance.list_sessions()
        if not any(s['id'] == session_id_to_load for s in all_sessions_meta):
             logger.warning(f"Session ID '{session_id_to_load}' not found in persistent storage during load attempt.")
             return jsonify({"error": "Session not found in persistent storage."}), 404
        # If session_obj is None after the check above, it means get_session failed more critically.
        if not session_obj: # Should ideally not happen if list_sessions found it and get_session is consistent
            logger.error(f"Session {session_id_to_load} was listed but get_session returned None. This indicates an inconsistency.")
            return jsonify({"error": "Session data could not be retrieved despite being listed."}), 500


        set_current_web_session_id(session_obj.id) # session_obj.id will be session_id_to_load

        # Update Flask session with settings from the loaded LLMCore session's metadata
        session_metadata = session_obj.metadata or {}
        flask_session['rag_enabled'] = session_metadata.get('rag_enabled', False)
        flask_session['rag_collection_name'] = session_metadata.get(
            'rag_collection_name',
            llmcore_instance.config.get("storage.vector.default_collection") if llmcore_instance.config else None
        )
        flask_session['rag_k_value'] = session_metadata.get(
            'rag_k_value',
            llmcore_instance.config.get("context_management.rag_retrieval_k", 3) if llmcore_instance.config else 3
        )
        flask_session['rag_filter'] = session_metadata.get('rag_filter') # Expects dict or None
        flask_session['current_provider_name'] = session_metadata.get(
            'current_provider_name',
            llmcore_instance.config.get("llmcore.default_provider") if llmcore_instance.config else None
        )
        flask_session['current_model_name'] = session_metadata.get('current_model_name') # Can be None
        flask_session['system_message'] = session_metadata.get('system_message', "")
        flask_session['prompt_template_values'] = session_metadata.get('prompt_template_values', {})

        # If model became None after loading from metadata, try to set to provider's default
        if flask_session.get('current_model_name') is None and flask_session.get('current_provider_name') and llmcore_instance.config:
             flask_session['current_model_name'] = llmcore_instance.config.get(f"providers.{flask_session['current_provider_name']}.default_model")

        flask_session.modified = True # Ensure session is saved

        logger.info(f"Successfully loaded session {session_obj.id}. Flask session RAG/LLM/Prompt settings updated from its metadata or defaults.")

        response_payload: Dict[str, Any] = {
            "session_data": session_obj.model_dump(mode="json"), # Full session data from LLMCore
            "applied_settings": { # The settings now active in Flask session
                "rag_enabled": flask_session['rag_enabled'],
                "rag_collection_name": flask_session['rag_collection_name'],
                "rag_k_value": flask_session['rag_k_value'],
                "rag_filter": flask_session['rag_filter'],
                "current_provider_name": flask_session['current_provider_name'],
                "current_model_name": flask_session['current_model_name'],
                "system_message": flask_session['system_message'],
                "prompt_template_values": flask_session['prompt_template_values'],
            }
        }
        return jsonify(response_payload)
    except SessionNotFoundError: # Should be caught if get_session raises it for non-existent ID
        logger.warning(f"Session {session_id_to_load} not found by LLMCore during load.")
        return jsonify({"error": "Session not found."}), 404
    except LLMCoreError as e:
        logger.error(f"Error loading session {session_id_to_load}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to load session: {str(e)}"}), 500
    except Exception as e_unexp:
        logger.error(f"Unexpected error loading session {session_id_to_load}: {e_unexp}", exc_info=True)
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
                set_current_web_session_id(None) # Clear from Flask session if it was current
                flask_session.modified = True
                logger.info(f"Cleared deleted session {session_id_to_delete} from current Flask session ID.")
            return jsonify({"message": f"Session '{session_id_to_delete}' deleted successfully."})
        else:
            # delete_session might return False if not found in persistent store and not in transient cache.
            logger.warning(f"Session {session_id_to_delete} not found by LLMCore for deletion, or already non-existent.")
            return jsonify({"error": "Session not found or could not be deleted by LLMCore (it may have already been deleted or never existed persistently)."}), 404
    except LLMCoreError as e: # Catch specific LLMCore errors during deletion
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
        # Assuming llmcore_instance.delete_message_from_session exists and returns boolean
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
    except LLMCoreError as e: # Catch other LLMCore specific errors
        logger.error(f"Error deleting message {message_id} from session {session_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to delete message: {str(e)}"}), 500
    except Exception as e_unexp:
        logger.error(f"Unexpected error deleting message {message_id} from session {session_id}: {e_unexp}", exc_info=True)
        return jsonify({"error": "An unexpected server error occurred while deleting the message."}), 500

logger.info("Session management routes defined on session_bp.")
