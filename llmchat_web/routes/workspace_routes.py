# llmchat_web/routes/workspace_routes.py
"""
Flask routes for workspace and context management in the llmchat-web application.
Handles operations on session-specific workspace items (context pool)
and context preview functionalities.
"""
import logging
from typing import Any, Dict, List, Union # Added List, Union for type hinting

from flask import jsonify, request
from flask import session as flask_session

# Import the specific blueprint defined in the routes package's __init__.py
from . import workspace_bp

# Import shared components from the main app module (llmchat_web.app)
from ..app import (
    llmcore_instance,
    async_to_sync_in_flask,
    logger as app_logger # Main app logger
    # get_current_web_session_id, set_current_web_session_id are not directly used here
    # but are available if needed for more complex logic.
)

# Import specific LLMCore exceptions and models relevant to workspace/context
from llmcore import (
    LLMCoreError, SessionNotFoundError, StorageError,
    ContextItem as LLMCoreContextItem, # Used for adding/retrieving workspace items
    ContextItemType as LLMCoreContextItemType, # For specifying item types
    Role as LLMCoreRole # Needed for add_message_to_workspace_route
    # ContextPreparationDetails is implicitly handled by preview_context_for_chat return type
)

# Import helper from chat_routes for resolving staged items, used in context preview
# This creates a dependency, which is acceptable for now.
# If this helper becomes more widely used, it could be moved to a shared routes.utils module.
try:
    from .chat_routes import _resolve_staged_items_for_core
except ImportError:
    # Fallback or error handling if chat_routes isn't available during standalone testing/linting
    # For runtime, this import should work.
    logger_ws_init = logging.getLogger("llmchat_web.routes.workspace_init")
    logger_ws_init.warning(
        "_resolve_staged_items_for_core could not be imported from .chat_routes. "
        "Context preview functionality might be affected if this persists at runtime."
    )
    # Define a dummy function to prevent NameError if import fails,
    # though this means preview will not work correctly.
    async def _resolve_staged_items_for_core(
        staged_items_from_js: List[Dict[str, Any]],
        session_id_for_staging: Any
    ) -> List[Union[Any, Any]]: # Use generic Any here for the dummy
        logger_ws_init.error("Dummy _resolve_staged_items_for_core called due to import error!")
        return []


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
    if not llmcore_instance:
        logger.error(f"Attempted to list workspace items for session {session_id}, but LLM service is not available.")
        return jsonify({"error": "LLM service not available."}), 503
    try:
        logger.debug(f"Listing workspace items for session: {session_id}")
        items = await llmcore_instance.get_session_context_items(session_id)
        item_list_json = [item.model_dump(mode="json") for item in items]
        logger.info(f"Successfully listed {len(item_list_json)} workspace items for session {session_id}.")
        return jsonify(item_list_json)
    except SessionNotFoundError:
        logger.warning(f"Session {session_id} not found when listing workspace items.")
        return jsonify({"error": "Session not found."}), 404
    except LLMCoreError as e:
        logger.error(f"Error listing workspace items for session {session_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to list workspace items: {str(e)}"}), 500
    except Exception as e_unexp:
        logger.error(f"Unexpected error listing workspace items for session {session_id}: {e_unexp}", exc_info=True)
        return jsonify({"error": "An unexpected server error occurred."}), 500


@workspace_bp.route("/<session_id>/workspace/items/<item_id>", methods=["GET"])
@async_to_sync_in_flask
async def get_workspace_item_route(session_id: str, item_id: str) -> Any:
    """
    Retrieves a specific workspace item by its ID from a given session.
    """
    if not llmcore_instance:
        logger.error(f"Attempted to get workspace item {item_id} for session {session_id}, but LLM service is not available.")
        return jsonify({"error": "LLM service not available."}), 503
    try:
        logger.debug(f"Getting workspace item '{item_id}' for session: {session_id}")
        item = await llmcore_instance.get_context_item(session_id, item_id)
        if item:
            logger.info(f"Successfully retrieved workspace item '{item_id}' for session {session_id}.")
            return jsonify(item.model_dump(mode="json"))
        else:
            logger.warning(f"Workspace item '{item_id}' not found in session {session_id}.")
            return jsonify({"error": "Workspace item not found."}), 404
    except SessionNotFoundError:
        logger.warning(f"Session {session_id} not found when getting workspace item '{item_id}'.")
        return jsonify({"error": "Session not found."}), 404
    except LLMCoreError as e:
        logger.error(f"Error getting workspace item {item_id} for session {session_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to get workspace item: {str(e)}"}), 500
    except Exception as e_unexp:
        logger.error(f"Unexpected error getting workspace item {item_id} for session {session_id}: {e_unexp}", exc_info=True)
        return jsonify({"error": "An unexpected server error occurred."}), 500


@workspace_bp.route("/<session_id>/workspace/add_text", methods=["POST"])
@async_to_sync_in_flask
async def add_text_to_workspace_route(session_id: str) -> Any:
    """
    Adds a text snippet as a new workspace item to the specified session.
    Expects JSON payload: {"content": "your text", "item_id": "optional_custom_id"}
    """
    if not llmcore_instance:
        logger.error(f"Attempted to add text to workspace for session {session_id}, but LLM service is not available.")
        return jsonify({"error": "LLM service not available."}), 503

    data = request.json
    if not data or "content" not in data:
        logger.warning(f"Add text to workspace for session {session_id} called without 'content' in payload.")
        return jsonify({"error": "Missing 'content' in request payload."}), 400

    content: str = data["content"]
    item_id: Optional[str] = data.get("item_id") # Optional custom ID from client

    try:
        logger.debug(f"Adding text to workspace for session {session_id}. Custom ID: {item_id}")
        added_item = await llmcore_instance.add_text_context_item(
            session_id=session_id,
            content=content,
            item_id=item_id # Pass along if provided
        )
        logger.info(f"Successfully added text item '{added_item.id}' to workspace for session {session_id}.")
        return jsonify(added_item.model_dump(mode="json")), 201 # 201 Created
    except SessionNotFoundError:
        logger.warning(f"Session {session_id} not found when adding text to workspace.")
        return jsonify({"error": "Session not found."}), 404
    except LLMCoreError as e:
        logger.error(f"Error adding text to workspace for session {session_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to add text to workspace: {str(e)}"}), 500
    except Exception as e_unexp:
        logger.error(f"Unexpected error adding text to workspace for session {session_id}: {e_unexp}", exc_info=True)
        return jsonify({"error": "An unexpected server error occurred."}), 500


@workspace_bp.route("/<session_id>/workspace/add_file", methods=["POST"])
@async_to_sync_in_flask
async def add_file_to_workspace_route(session_id: str) -> Any:
    """
    Adds a server-side file's content as a new workspace item to the specified session.
    Expects JSON payload: {"file_path": "/path/to/file_on_server", "item_id": "optional_custom_id"}
    """
    if not llmcore_instance:
        logger.error(f"Attempted to add file to workspace for session {session_id}, but LLM service is not available.")
        return jsonify({"error": "LLM service not available."}), 503

    data = request.json
    if not data or "file_path" not in data:
        logger.warning(f"Add file to workspace for session {session_id} called without 'file_path' in payload.")
        return jsonify({"error": "Missing 'file_path' in request payload."}), 400

    file_path: str = data["file_path"]
    item_id: Optional[str] = data.get("item_id") # Optional custom ID

    try:
        logger.debug(f"Adding file '{file_path}' to workspace for session {session_id}. Custom ID: {item_id}")
        added_item = await llmcore_instance.add_file_context_item(
            session_id=session_id,
            file_path=file_path,
            item_id=item_id # Pass along if provided
        )
        logger.info(f"Successfully added file item '{added_item.id}' (from path: {file_path}) to workspace for session {session_id}.")
        return jsonify(added_item.model_dump(mode="json")), 201 # 201 Created
    except FileNotFoundError: # Raised by LLMCore if file_path is invalid
        logger.warning(f"File not found at server path '{file_path}' when adding to workspace for session {session_id}.")
        return jsonify({"error": f"File not found at server path: {file_path}"}), 404
    except SessionNotFoundError:
        logger.warning(f"Session {session_id} not found when adding file to workspace.")
        return jsonify({"error": "Session not found."}), 404
    except (LLMCoreError, StorageError) as e: # StorageError if file reading fails internally in LLMCore
        logger.error(f"Error adding file {file_path} to workspace for session {session_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to add file to workspace: {str(e)}"}), 500
    except Exception as e_unexp:
        logger.error(f"Unexpected error adding file {file_path} to workspace for session {session_id}: {e_unexp}", exc_info=True)
        return jsonify({"error": "An unexpected server error occurred."}), 500


@workspace_bp.route("/<session_id>/workspace/items/<item_id>", methods=["DELETE"])
@async_to_sync_in_flask
async def remove_workspace_item_route(session_id: str, item_id: str) -> Any:
    """
    Removes a workspace item by its ID from the specified session.
    """
    if not llmcore_instance:
        logger.error(f"Attempted to remove workspace item {item_id} for session {session_id}, but LLM service is not available.")
        return jsonify({"error": "LLM service not available."}), 503
    try:
        logger.info(f"Attempting to remove workspace item '{item_id}' from session '{session_id}'.")
        success = await llmcore_instance.remove_context_item(session_id, item_id)
        if success:
            logger.info(f"Successfully removed workspace item '{item_id}' from session '{session_id}'.")
            return jsonify({"message": f"Workspace item '{item_id}' removed successfully."})
        else:
            # LLMCore's remove_context_item might return False if item not found
            logger.warning(f"Workspace item '{item_id}' not found in session '{session_id}' for removal.")
            return jsonify({"error": "Workspace item not found or could not be removed."}), 404
    except SessionNotFoundError:
        logger.warning(f"Session {session_id} not found when removing workspace item '{item_id}'.")
        return jsonify({"error": "Session not found."}), 404
    except LLMCoreError as e:
        logger.error(f"Error removing workspace item {item_id} for session {session_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to remove workspace item: {str(e)}"}), 500
    except Exception as e_unexp:
        logger.error(f"Unexpected error removing workspace item {item_id} for session {session_id}: {e_unexp}", exc_info=True)
        return jsonify({"error": "An unexpected server error occurred."}), 500


@workspace_bp.route("/<session_id>/workspace/add_from_message", methods=["POST"])
@async_to_sync_in_flask
async def add_message_to_workspace_route(session_id: str) -> Any:
    """
    Adds content of a specific message from the session's history to its workspace items.
    Expects JSON payload: {"message_id": "id_of_message_to_add"}
    """
    if not llmcore_instance:
        logger.error(f"Attempted to add message to workspace for session {session_id}, but LLM service is not available.")
        return jsonify({"error": "LLM service not available."}), 503

    data = request.json
    if not data or "message_id" not in data:
        logger.warning(f"Add message to workspace for session {session_id} called without 'message_id' in payload.")
        return jsonify({"error": "Missing 'message_id' in request payload."}), 400
    message_id_to_add: str = data["message_id"]

    try:
        logger.debug(f"Attempting to add message '{message_id_to_add}' to workspace for session '{session_id}'.")
        session_obj = await llmcore_instance.get_session(session_id)
        if not session_obj: # Should be caught by SessionNotFoundError if LLMCore raises it
            logger.warning(f"Session {session_id} not found when trying to add message {message_id_to_add} to workspace.")
            return jsonify({"error": "Session not found."}), 404 # Defensive

        message_to_add = next((m for m in session_obj.messages if m.id == message_id_to_add), None)
        if not message_to_add:
            logger.warning(f"Message '{message_id_to_add}' not found in session '{session_id}' to add to workspace.")
            return jsonify({"error": "Message not found in session."}), 404

        # Create a unique ID for the new workspace item derived from the message ID
        workspace_item_id = f"ws_from_msg_{message_id_to_add[:8]}" # Example ID generation
        added_item = await llmcore_instance.add_text_context_item(
            session_id=session_id,
            content=message_to_add.content,
            item_id=workspace_item_id, # Use the generated or a more robust unique ID
            source_id=f"message:{message_id_to_add}", # Reference the original message
            metadata={
                "original_message_role": message_to_add.role.value if isinstance(message_to_add.role, LLMCoreRole) else str(message_to_add.role),
                "original_message_id": message_id_to_add
            }
        )
        logger.info(f"Successfully added message '{message_id_to_add}' as workspace item '{added_item.id}' for session {session_id}.")
        return jsonify(added_item.model_dump(mode="json")), 201 # 201 Created
    except SessionNotFoundError:
        logger.warning(f"Session {session_id} not found when adding message {message_id_to_add} to workspace.")
        return jsonify({"error": "Session not found."}), 404
    except LLMCoreError as e:
        logger.error(f"Error adding message {message_id_to_add} to workspace for session {session_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to add message to workspace: {str(e)}"}), 500
    except Exception as e_unexp:
        logger.error(f"Unexpected error adding message {message_id_to_add} to workspace for session {session_id}: {e_unexp}", exc_info=True)
        return jsonify({"error": "An unexpected server error occurred."}), 500


# --- Context Preview API Endpoint ---
# This route is /api/sessions/<session_id>/context/preview
@workspace_bp.route("/<session_id>/context/preview", methods=["POST"])
@async_to_sync_in_flask
async def preview_context_route(session_id: str) -> Any:
    """
    Previews the full context that LLMCore would prepare for a chat interaction.
    This includes message history, RAG documents (if enabled), and explicitly staged items.
    Uses settings from the current Flask session (RAG, LLM provider/model, system message).

    Expects JSON payload:
    {
        "current_query": "Optional: The user's next query text for more accurate preview.",
        "staged_items": "Optional: Array of client-side staged items to include in preview."
    }
    """
    if not llmcore_instance:
        logger.error(f"Attempted to preview context for session {session_id}, but LLM service is not available.")
        return jsonify({"error": "LLM service not available."}), 503

    data = request.json
    current_query_for_preview: Optional[str] = data.get("current_query") if data else None
    staged_items_from_js: List[Dict[str, Any]] = data.get("staged_items", []) if data else []

    logger.debug(f"Previewing context for session {session_id}. Query: '{current_query_for_preview}'. Staged items from JS: {len(staged_items_from_js)}")

    try:
        # Resolve client-side staged items into LLMCore objects
        # This helper is currently imported from chat_routes.
        explicitly_staged_items_for_core: List[Union[Any, Any]] = \
            await _resolve_staged_items_for_core(staged_items_from_js, session_id)

        # Call LLMCore's preview method
        preview_details_dict = await llmcore_instance.preview_context_for_chat(
            current_user_query=current_query_for_preview or "", # Must be a string
            session_id=session_id,
            # Get LLM and RAG settings from Flask session
            system_message=flask_session.get('system_message'),
            provider_name=flask_session.get('current_provider_name'),
            model_name=flask_session.get('current_model_name'),
            explicitly_staged_items=explicitly_staged_items_for_core, # type: ignore
            enable_rag=flask_session.get('rag_enabled', False),
            rag_collection_name=flask_session.get('rag_collection_name'),
            rag_retrieval_k=flask_session.get('rag_k_value'),
            rag_metadata_filter=flask_session.get('rag_filter'), # dict or None
            prompt_template_values=flask_session.get('prompt_template_values', {})
        )
        # preview_context_for_chat returns a Pydantic model, which .model_dump()s to dict
        logger.info(f"Successfully generated context preview for session {session_id}.")
        return jsonify(preview_details_dict) # Already a dict from model_dump
    except SessionNotFoundError:
        logger.warning(f"Session {session_id} not found when generating context preview.")
        return jsonify({"error": "Session not found."}), 404
    except LLMCoreError as e:
        logger.error(f"Error generating context preview for session {session_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to generate context preview: {str(e)}"}), 500
    except Exception as e_resolve_preview: # Catch errors from _resolve_staged_items_for_core or other unexpected
        logger.error(f"Unexpected error resolving or generating context preview for session {session_id}: {e_resolve_preview}", exc_info=True)
        return jsonify({"error": f"Failed to process or generate context preview: {str(e_resolve_preview)}"}), 500

logger.info("Workspace and context management routes defined on workspace_bp.")
