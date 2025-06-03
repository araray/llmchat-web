# llmchat_web/routes.py
"""
Flask routes for the llmchat-web application.
Organized into a blueprint for modularity.
Routes are defined here and decorate the `main_bp` Blueprint
which is imported from the main app module.
Includes SSE progress reporting for file ingestion.
"""
import asyncio
import json
import logging
import uuid
from typing import Any, AsyncGenerator, Dict, Optional, List, Union
from pathlib import Path
from datetime import datetime
import tempfile
import shutil
import zipfile

from flask import (
    Response, jsonify, render_template, request,
    stream_with_context)
from flask import session as flask_session
from werkzeug.utils import secure_filename

# Import shared components from .app (app.py)
from .app import (
    main_bp,
    app, # Flask app instance, useful for some extensions or direct use if needed
    llmcore_instance,
    llmcore_init_error as global_llmcore_init_error,
    async_to_sync_in_flask, # Key wrapper for calling async code from sync routes
    get_context_usage_info,
    get_current_web_session_id,
    set_current_web_session_id,
    logger as app_logger, # Main app logger
    APP_VERSION
)

# Import specific LLMCore exceptions and models
from llmcore import (
    ContextLengthError, LLMCoreError, ProviderError,
    SessionNotFoundError, ChatSession as LLMCoreChatSession,
    Message as LLMCoreMessage, Role as LLMCoreRole,
    ContextItem as LLMCoreContextItem, ContextItemType as LLMCoreContextItemType,
    ContextDocument as LLMCoreContextDocument,
    StorageError, ContextPreparationDetails, VectorStorageError
)

# Attempt to import Apykatu and GitPython for ingestion
APYKATU_AVAILABLE = False
GITPYTHON_AVAILABLE = False
try:
    from apykatu.pipelines.ingest import IngestionPipeline
    from apykatu.api import process_file_path as apykatu_process_file_path_api
    from apykatu.config.models import AppConfig as ApykatuAppConfig
    from apykatu.config.models import ConfigError as ApykatuConfigError
    from apykatu.api_models import ProcessedChunk as ApykatuProcessedChunk
    from apykatu.api_models import ProcessingStats as ApykatuProcessingStats
    APYKATU_AVAILABLE = True
except ImportError:
    app_logger.warning("Apykatu library not found. Ingestion features will be disabled.")
    ApykatuAppConfig = type('ApykatuAppConfig', (object,), {}) # type: ignore
    ApykatuProcessedChunk = type('ApykatuProcessedChunk', (object,), {}) # type: ignore
    ApykatuProcessingStats = type('ApykatuProcessingStats', (object,), {}) # type: ignore
    # Define dummy IngestionPipeline if not available
    class IngestionPipeline: # type: ignore
        def __init__(self, *args, **kwargs): pass
        async def run(self, *args, **kwargs): pass


try:
    import git # GitPython
    GITPYTHON_AVAILABLE = True
except ImportError:
    app_logger.warning("GitPython library not found. Git ingestion will be disabled.")

# Configure a local logger for this routes module
logger = logging.getLogger("llmchat_web.routes")
if not logger.handlers: # Check if handlers are already added
    logger.parent = app_logger # type: ignore
    logger.setLevel(app_logger.level if app_logger else logging.DEBUG)


# --- Route Implementations ---

@main_bp.route("/")
def index() -> str:
    """
    Serves the main HTML page for the llmchat-web interface.
    Initializes Flask session variables if not already set.
    """
    logger.debug(f"Serving index.html. LLMCore status: {'OK' if llmcore_instance else 'Error'}")
    if 'current_llm_session_id' not in flask_session:
        new_temp_id = f"web_initial_session_{uuid.uuid4().hex[:8]}"
        set_current_web_session_id(new_temp_id)
        logger.info(f"No LLMCore session ID in Flask session. Initialized with temporary ID: {new_temp_id}")

    # Initialize RAG settings in session if not present
    if 'rag_enabled' not in flask_session:
        flask_session['rag_enabled'] = False
        logger.debug("Flask session 'rag_enabled' initialized to False.")
    if 'rag_collection_name' not in flask_session:
        default_rag_collection = None
        if llmcore_instance and llmcore_instance.config:
            default_rag_collection = llmcore_instance.config.get("storage.vector.default_collection")
        flask_session['rag_collection_name'] = default_rag_collection
        logger.debug(f"Flask session 'rag_collection_name' initialized to: {flask_session['rag_collection_name']}")
    if 'rag_k_value' not in flask_session:
        default_rag_k = 3
        if llmcore_instance and llmcore_instance.config:
            default_rag_k = llmcore_instance.config.get("context_management.rag_retrieval_k", 3)
        flask_session['rag_k_value'] = default_rag_k
        logger.debug(f"Flask session 'rag_k_value' initialized to: {flask_session['rag_k_value']}")
    if 'rag_filter' not in flask_session: # Stored as dict or None
        flask_session['rag_filter'] = None
        logger.debug("Flask session 'rag_filter' initialized to None.")

    # Initialize LLM settings in session if not present
    if 'current_provider_name' not in flask_session and llmcore_instance and llmcore_instance.config:
        flask_session['current_provider_name'] = llmcore_instance.config.get("llmcore.default_provider")
        logger.debug(f"Flask session 'current_provider_name' initialized to LLMCore default: {flask_session.get('current_provider_name')}")

    if 'current_model_name' not in flask_session and llmcore_instance and llmcore_instance.config:
        default_model = None
        provider_name = flask_session.get('current_provider_name')
        if provider_name:
            provider_conf_key = f"providers.{provider_name}"
            default_model = llmcore_instance.config.get(f"{provider_conf_key}.default_model")
        flask_session['current_model_name'] = default_model
        logger.debug(f"Flask session 'current_model_name' initialized: {flask_session.get('current_model_name')}")

    if 'system_message' not in flask_session:
        flask_session['system_message'] = "" # Default to empty system message
        logger.debug("Flask session 'system_message' initialized to empty string.")

    # Initialize Prompt Template Values in session if not present
    if 'prompt_template_values' not in flask_session:
        flask_session['prompt_template_values'] = {}
        logger.debug("Flask session 'prompt_template_values' initialized to empty dict.")


    return render_template("index.html", app_version=APP_VERSION)


@main_bp.route("/api/status", methods=["GET"])
def api_status() -> Any:
    """
    API endpoint to check the status of the backend and LLMCore.
    Also returns current provider/model, session ID, RAG settings, system message,
    and prompt template values from Flask session.
    """
    llmcore_status_val = "operational"; llmcore_error_detail_val = None
    llmcore_default_provider_val = None; llmcore_default_model_val = None

    if global_llmcore_init_error:
        llmcore_status_val = "error"; llmcore_error_detail_val = global_llmcore_init_error
    elif llmcore_instance is None:
        llmcore_status_val = "initializing"; llmcore_error_detail_val = "LLMCore instance is None."
    elif llmcore_instance and llmcore_instance.config:
        llmcore_default_provider_val = llmcore_instance.config.get("llmcore.default_provider")
        if llmcore_default_provider_val:
            provider_conf_key = f"providers.{llmcore_default_provider_val}"
            llmcore_default_model_val = llmcore_instance.config.get(f"{provider_conf_key}.default_model")
    else:
        llmcore_status_val = "error"; llmcore_error_detail_val = "LLMCore instance exists but its config is unavailable."

    current_provider_val = flask_session.get('current_provider_name', llmcore_default_provider_val)
    current_model_val = flask_session.get('current_model_name', llmcore_default_model_val)
    current_session_id_val = get_current_web_session_id()

    # Ensure model is consistent with provider if provider is set
    if current_model_val is None and current_provider_val and llmcore_instance and llmcore_instance.config:
        current_model_val = llmcore_instance.config.get(f"providers.{current_provider_val}.default_model")

    rag_enabled_val = flask_session.get('rag_enabled', False)
    rag_collection_name_val = flask_session.get('rag_collection_name')
    rag_k_val = flask_session.get('rag_k_value')
    rag_filter_val = flask_session.get('rag_filter')
    system_message_val = flask_session.get('system_message', "")
    prompt_template_values_val = flask_session.get('prompt_template_values', {})


    return jsonify({
        "service_status": "operational", "llmcore_status": llmcore_status_val,
        "llmcore_error": llmcore_error_detail_val,
        "current_provider": current_provider_val, "current_model": current_model_val,
        "current_session_id": current_session_id_val,
        "app_version": APP_VERSION, "timestamp": datetime.utcnow().isoformat() + "Z",
        "rag_enabled": rag_enabled_val,
        "rag_collection_name": rag_collection_name_val,
        "rag_k_value": rag_k_val,
        "rag_filter": rag_filter_val,
        "system_message": system_message_val,
        "prompt_template_values": prompt_template_values_val,
    })

async def _get_last_assistant_message_id(session_id: Optional[str]) -> Optional[str]:
    """Helper to get the ID of the last assistant message in a session."""
    if not llmcore_instance or not session_id:
        return None
    try:
        session_obj = await llmcore_instance.get_session(session_id)
        if session_obj and session_obj.messages:
            for msg in reversed(session_obj.messages):
                if msg.role == LLMCoreRole.ASSISTANT:
                    return msg.id
    except SessionNotFoundError:
        logger.warning(f"Session {session_id} not found while trying to get last assistant message ID.")
    except LLMCoreError as e:
        logger.error(f"LLMCoreError getting last assistant message ID for session {session_id}: {e}")
    return None

async def _resolve_staged_items_for_core(
    staged_items_from_js: List[Dict[str, Any]],
    session_id_for_staging: Optional[str]
) -> List[Union[LLMCoreMessage, LLMCoreContextItem]]:
    """
    Resolves items from the client's active_context_specification
    into LLMCoreMessage or LLMCoreContextItem objects.
    """
    if not llmcore_instance:
        return []

    explicitly_staged_items: List[Union[LLMCoreMessage, LLMCoreContextItem]] = []
    if not staged_items_from_js:
        return explicitly_staged_items

    for js_item in staged_items_from_js:
        item_type_str = js_item.get('type')
        item_content = js_item.get('content')
        item_path = js_item.get('path')
        item_id_ref = js_item.get('id_ref')
        item_spec_id = js_item.get('spec_item_id', f"staged_{uuid.uuid4().hex[:4]}")
        no_truncate = js_item.get('no_truncate', False)
        resolved_item: Optional[Union[LLMCoreMessage, LLMCoreContextItem]] = None

        try:
            if item_type_str == "message_history" and item_id_ref and session_id_for_staging:
                sess_obj = await llmcore_instance.get_session(session_id_for_staging)
                if sess_obj:
                    resolved_item = next((m for m in sess_obj.messages if m.id == item_id_ref), None)
            elif item_type_str == "workspace_item" and item_id_ref and session_id_for_staging:
                resolved_item = await llmcore_instance.get_context_item(session_id_for_staging, item_id_ref)
            elif item_type_str == "file_content" and item_path: # Content might be fetched by LLMCore if not provided
                resolved_item = LLMCoreContextItem(
                    id=item_spec_id, type=LLMCoreContextItemType.USER_FILE,
                    content=item_content, # Pass content if available, LLMCore might load if None
                    source_id=item_path,
                    metadata={"filename": Path(item_path).name, "llmchat_web_staged": True, "ignore_char_limit": no_truncate}
                )
            elif item_type_str == "text_content" and item_content is not None:
                resolved_item = LLMCoreContextItem(
                    id=item_spec_id, type=LLMCoreContextItemType.USER_TEXT, content=item_content,
                    source_id=item_spec_id, metadata={"llmchat_web_staged": True, "ignore_char_limit": no_truncate}
                )

            if resolved_item:
                explicitly_staged_items.append(resolved_item)
            else:
                logger.warning(f"Could not resolve staged item from JS: {js_item}")
        except Exception as e_resolve:
            logger.error(f"Error resolving staged item {js_item}: {e_resolve}", exc_info=True)

    return explicitly_staged_items


async def _stream_chat_responses_route_helper(llm_core_chat_params: Dict[str, Any]) -> AsyncGenerator[str, None]:
    """
    Async generator for streaming chat responses.
    This encapsulates the LLMCore call and SSE formatting.
    """
    if not llmcore_instance:
        yield f"data: {json.dumps({'type': 'error', 'error': 'LLM service not available.'})}\n\n"
        yield f"data: {json.dumps({'type': 'end'})}\n\n" # Ensure stream ends
        return

    last_assistant_message_id: Optional[str] = None
    context_usage_data: Optional[Dict[str, Any]] = None

    call_params = llm_core_chat_params.copy()
    # 'explicitly_staged_items' should already be resolved and in call_params by api_chat

    try:
        # LLMCore.chat with stream=True returns an AsyncGenerator[str, None]
        async for chunk_content in llmcore_instance.chat(**call_params): # type: ignore
            yield f"data: {json.dumps({'type': 'chunk', 'content': chunk_content})}\n\n"
            await asyncio.sleep(0.01) # Small sleep to allow other tasks, if any

        # After stream completion, fetch metadata
        session_id_for_meta = call_params.get("session_id")
        if session_id_for_meta:
            last_assistant_message_id = await _get_last_assistant_message_id(session_id_for_meta)
            context_usage_data = await get_context_usage_info(session_id_for_meta)

        if last_assistant_message_id:
            yield f"data: {json.dumps({'type': 'full_response_id', 'message_id': last_assistant_message_id})}\n\n"
        if context_usage_data:
            yield f"data: {json.dumps({'type': 'context_usage', 'data': context_usage_data})}\n\n"

    except (ProviderError, ContextLengthError, SessionNotFoundError, LLMCoreError) as e:
        logger.error(f"LLMCore chat error during stream: {e}", exc_info=True)
        yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
    except Exception as e:
        logger.error(f"Unexpected error during chat stream: {e}", exc_info=True)
        yield f"data: {json.dumps({'type': 'error', 'error': 'An unexpected server error occurred during chat.'})}\n\n"
    finally:
        yield f"data: {json.dumps({'type': 'end'})}\n\n"


# Helper to run an async generator synchronously for stream_with_context
# This is needed when the route itself is synchronous (like default Flask with Gunicorn sync workers)
def run_async_generator_synchronously(async_gen_func, *args, **kwargs):
    """
    Runs an asynchronous generator function synchronously.
    Creates a new event loop to run the async generator and yields its items.
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        async_gen = async_gen_func(*args, **kwargs)
        while True:
            try:
                item = loop.run_until_complete(async_gen.__anext__())
                yield item
            except StopAsyncIteration:
                break
    finally:
        logger.debug("Closing event loop for run_async_generator_synchronously.")
        try:
            async def _shutdown_loop_tasks(current_loop: asyncio.AbstractEventLoop):
                tasks = [t for t in asyncio.all_tasks(loop=current_loop) if t is not asyncio.current_task(loop=current_loop)]
                if tasks:
                    logger.debug(f"Cancelling {len(tasks)} outstanding tasks in sync generator's loop.")
                    for task in tasks: task.cancel()
                    await asyncio.gather(*tasks, return_exceptions=True)
                logger.debug("Shutting down async generators in sync generator's loop.")
                await current_loop.shutdown_asyncgens()
            loop.run_until_complete(_shutdown_loop_tasks(loop))
        except Exception as e_shutdown:
            logger.error(f"Error during shutdown of tasks/asyncgens in sync generator's loop: {e_shutdown}")
        finally:
            loop.close()
            logger.debug("Event loop for run_async_generator_synchronously closed.")
            if asyncio.get_event_loop_policy().get_event_loop() is loop:
                asyncio.set_event_loop(None)


@main_bp.route("/api/chat", methods=["POST"])
def api_chat() -> Any: # Changed to sync def
    """
    Handles chat messages from the user.
    Supports streaming responses using Server-Sent Events (SSE).
    Reads RAG settings, LLM settings, and prompt template values from Flask session.
    This route is now synchronous to work with Gunicorn's sync workers.
    """
    if not llmcore_instance:
        return jsonify({"error": "LLM service not available."}), 503

    data = request.json
    if not data or "message" not in data:
        return jsonify({"error": "No message provided."}), 400

    user_message_content = data["message"]
    session_id_from_request = data.get("session_id", get_current_web_session_id())
    stream_requested = data.get("stream", True)
    active_context_spec_from_js = data.get('active_context_specification', [])

    try:
        # Call async helper synchronously
        explicitly_staged_items = async_to_sync_in_flask(_resolve_staged_items_for_core)(
            active_context_spec_from_js, session_id_from_request
        )
    except Exception as e_resolve_ctx:
        logger.error(f"Error resolving context items for chat: {e_resolve_ctx}", exc_info=True)
        return jsonify({"error": f"Failed to process context items: {str(e_resolve_ctx)}"}), 500

    logger.debug(
        f"Chat request for session '{session_id_from_request}'. "
        f"Provider: {flask_session.get('current_provider_name')}, Model: {flask_session.get('current_model_name')}. "
        f"RAG: {flask_session.get('rag_enabled', False)}, Collection: {flask_session.get('rag_collection_name')}, K: {flask_session.get('rag_k_value')}, Filter: {flask_session.get('rag_filter')}. "
        f"SystemMsg: '{flask_session.get('system_message', '')[:50]}...'. "
        f"PromptValues: {flask_session.get('prompt_template_values', {})}. "
        f"Resolved staged items: {len(explicitly_staged_items)}"
    )

    llm_core_params = {
        "message": user_message_content,
        "session_id": session_id_from_request,
        "provider_name": flask_session.get('current_provider_name'),
        "model_name": flask_session.get('current_model_name'),
        "system_message": flask_session.get('system_message'),
        "save_session": True,
        "enable_rag": flask_session.get('rag_enabled', False),
        "rag_collection_name": flask_session.get('rag_collection_name'),
        "rag_retrieval_k": flask_session.get('rag_k_value'),
        "rag_metadata_filter": flask_session.get('rag_filter'),
        "prompt_template_values": flask_session.get('prompt_template_values', {}),
        "explicitly_staged_items": explicitly_staged_items
    }

    if stream_requested:
        llm_core_params["stream"] = True
        # Use the synchronous generator wrapper for stream_with_context
        sync_generator = run_async_generator_synchronously(_stream_chat_responses_route_helper, llm_core_params)
        return Response(stream_with_context(sync_generator), content_type="text/event-stream")
    else:
        try:
            llm_core_params["stream"] = False
            # Call async LLMCore.chat synchronously
            response_content_str = async_to_sync_in_flask(llmcore_instance.chat)(**llm_core_params) # type: ignore
            # Call async helpers synchronously
            last_msg_id = async_to_sync_in_flask(_get_last_assistant_message_id)(session_id_from_request)
            ctx_usage = async_to_sync_in_flask(get_context_usage_info)(session_id_from_request)

            return jsonify({
                "role": "assistant", "content": response_content_str,
                "message_id": last_msg_id, "context_usage": ctx_usage
            })
        except (ProviderError, ContextLengthError, SessionNotFoundError, LLMCoreError) as e:
            logger.error(f"LLMCore chat error (non-stream): {e}", exc_info=True)
            return jsonify({"error": str(e)}), 500
        except Exception as e:
            logger.error(f"Unexpected error during non-stream chat: {e}", exc_info=True)
            return jsonify({"error": "An unexpected server error occurred."}), 500


# --- Session Management API Endpoints ---
@main_bp.route("/api/sessions", methods=["GET"])
@async_to_sync_in_flask
async def list_sessions_route():
    """Lists all available LLMCore sessions."""
    if not llmcore_instance: return jsonify({"error": "LLM service not available."}), 503
    try:
        sessions = await llmcore_instance.list_sessions()
        return jsonify(sessions)
    except LLMCoreError as e:
        logger.error(f"Error listing sessions: {e}", exc_info=True)
        return jsonify({"error": f"Failed to list sessions: {str(e)}"}), 500

@main_bp.route("/api/sessions/new", methods=["POST"])
@async_to_sync_in_flask
async def new_session_route():
    """Creates a new LLMCore session and sets it as current in Flask session, resetting relevant session variables."""
    if not llmcore_instance: return jsonify({"error": "LLM service not available."}), 503
    try:
        new_llmcore_session_id = f"web_session_{uuid.uuid4().hex}"
        set_current_web_session_id(new_llmcore_session_id)

        flask_session['rag_enabled'] = False
        flask_session['rag_collection_name'] = llmcore_instance.config.get("storage.vector.default_collection") if llmcore_instance.config else None
        flask_session['rag_k_value'] = llmcore_instance.config.get("context_management.rag_retrieval_k", 3) if llmcore_instance.config else 3
        flask_session['rag_filter'] = None
        flask_session['current_provider_name'] = llmcore_instance.config.get("llmcore.default_provider") if llmcore_instance.config else None
        if flask_session.get('current_provider_name') and llmcore_instance.config:
            flask_session['current_model_name'] = llmcore_instance.config.get(f"providers.{flask_session['current_provider_name']}.default_model")
        else:
            flask_session['current_model_name'] = None
        flask_session['system_message'] = ""
        flask_session['prompt_template_values'] = {}

        logger.info(f"New web session initiated with ID: {new_llmcore_session_id}. RAG/LLM/Prompt settings reset to defaults.")

        # Note: This endpoint does NOT create a persistent LLMCore session yet.
        # It only prepares the Flask session. LLMCore session is created on first chat.
        return jsonify({
            "id": new_llmcore_session_id, # This is the ID for the *next* LLMCore session
            "name": None, # LLMCore session name, not yet set
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
        }), 201
    except LLMCoreError as e: # Catch broad LLMCore errors if config access fails
        logger.error(f"Error creating new session context: {e}", exc_info=True)
        return jsonify({"error": f"Failed to initialize new session context: {str(e)}"}), 500

@main_bp.route("/api/sessions/<session_id_to_load>/load", methods=["GET"])
@async_to_sync_in_flask
async def load_session_route(session_id_to_load: str):
    """Loads an existing LLMCore session, sets it as current, and returns its details along with session-specific settings."""
    if not llmcore_instance: return jsonify({"error": "LLM service not available."}), 503
    try:
        session_obj = await llmcore_instance.get_session(session_id_to_load)
        if not session_obj: # get_session might return a new empty session if ID not found.
                           # We need to check if it actually loaded an *existing* one.
                           # This check might need refinement based on get_session behavior.
                           # If get_session *always* returns a session (new or existing),
                           # we need a way to know if it was pre-existing.
                           # For now, assume if messages are empty, it might be "newly created by get_session".
                           # A better check: if session_obj.created_at == session_obj.updated_at and no messages.
            # Check if it's truly not found or just empty new one
            all_sessions_meta = await llmcore_instance.list_sessions()
            if not any(s['id'] == session_id_to_load for s in all_sessions_meta):
                 logger.warning(f"Session ID '{session_id_to_load}' not found in persistent storage during load attempt.")
                 return jsonify({"error": "Session not found in persistent storage."}), 404

        set_current_web_session_id(session_obj.id) # session_obj.id will be session_id_to_load

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
        flask_session['current_model_name'] = session_metadata.get('current_model_name')
        flask_session['system_message'] = session_metadata.get('system_message', "")
        flask_session['prompt_template_values'] = session_metadata.get('prompt_template_values', {})


        if flask_session.get('current_model_name') is None and flask_session.get('current_provider_name') and llmcore_instance.config:
             flask_session['current_model_name'] = llmcore_instance.config.get(f"providers.{flask_session['current_provider_name']}.default_model")

        logger.info(f"Loaded session {session_obj.id}. Flask session RAG/LLM/Prompt settings updated from metadata or defaults.")

        return jsonify({
            "session_data": session_obj.model_dump(mode="json"),
            "applied_settings": {
                "rag_enabled": flask_session['rag_enabled'],
                "rag_collection_name": flask_session['rag_collection_name'],
                "rag_k_value": flask_session['rag_k_value'],
                "rag_filter": flask_session['rag_filter'],
                "current_provider_name": flask_session['current_provider_name'],
                "current_model_name": flask_session['current_model_name'],
                "system_message": flask_session['system_message'],
                "prompt_template_values": flask_session['prompt_template_values'],
            }
        })
    except SessionNotFoundError: # Should be caught if get_session raises it for non-existent ID
        return jsonify({"error": "Session not found."}), 404
    except LLMCoreError as e:
        logger.error(f"Error loading session {session_id_to_load}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to load session: {str(e)}"}), 500

@main_bp.route("/api/sessions/<session_id_to_delete>", methods=["DELETE"])
@async_to_sync_in_flask
async def delete_session_route(session_id_to_delete: str):
    """Deletes an LLMCore session."""
    if not llmcore_instance: return jsonify({"error": "LLM service not available."}), 503
    try:
        deleted = await llmcore_instance.delete_session(session_id_to_delete)
        if deleted:
            if get_current_web_session_id() == session_id_to_delete:
                set_current_web_session_id(None) # Clear from Flask session if it was current
                logger.info(f"Deleted current session {session_id_to_delete}. Flask session ID cleared.")
            return jsonify({"message": f"Session '{session_id_to_delete}' deleted."})
        else:
            # delete_session returns True if found in either cache or persistent and deletion attempted.
            # False means it was not found in persistent and not in transient cache.
            return jsonify({"error": "Session not found or could not be deleted by LLMCore (already non-existent)."}), 404
    except LLMCoreError as e:
        logger.error(f"Error deleting session {session_id_to_delete}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to delete session: {str(e)}"}), 500

# --- Per-Message Action Endpoints ---
@main_bp.route("/api/sessions/<session_id>/messages/<message_id>", methods=["DELETE"])
@async_to_sync_in_flask
async def delete_message_from_session_route(session_id: str, message_id: str):
    """Deletes a specific message from a session using LLMCore."""
    if not llmcore_instance: return jsonify({"error": "LLM service not available."}), 503
    try:
        success = await llmcore_instance.delete_message_from_session(session_id, message_id) # Assuming this method exists on LLMCore
        if success:
            return jsonify({"message": f"Message '{message_id}' deleted from session '{session_id}'."})
        else:
            return jsonify({"error": "Message not found in session or could not be deleted."}), 404
    except SessionNotFoundError:
        return jsonify({"error": f"Session '{session_id}' not found."}), 404
    except LLMCoreError as e:
        logger.error(f"Error deleting message {message_id} from session {session_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to delete message: {str(e)}"}), 500

@main_bp.route("/api/sessions/<session_id>/workspace/add_from_message", methods=["POST"])
@async_to_sync_in_flask
async def add_message_to_workspace_route(session_id: str):
    """Adds content of a message to the session's workspace items using LLMCore."""
    if not llmcore_instance: return jsonify({"error": "LLM service not available."}), 503
    data = request.json
    if not data or "message_id" not in data:
        return jsonify({"error": "Missing 'message_id'."}), 400
    message_id = data["message_id"]
    try:
        session_obj = await llmcore_instance.get_session(session_id)
        if not session_obj: return jsonify({"error": "Session not found."}), 404

        message_to_add = next((m for m in session_obj.messages if m.id == message_id), None)
        if not message_to_add: return jsonify({"error": "Message not found in session."}), 404

        item_id_for_workspace = f"ws_from_msg_{message_id[:8]}"
        added_item = await llmcore_instance.add_text_context_item(
            session_id=session_id,
            content=message_to_add.content,
            item_id=item_id_for_workspace,
            source_id=f"message:{message_id}",
            metadata={"original_message_role": message_to_add.role.value if isinstance(message_to_add.role, LLMCoreRole) else str(message_to_add.role)}
        )
        return jsonify(added_item.model_dump(mode="json")), 201
    except SessionNotFoundError:
        return jsonify({"error": "Session not found."}), 404
    except LLMCoreError as e:
        logger.error(f"Error adding message {message_id} to workspace for session {session_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to add message to workspace: {str(e)}"}), 500

# --- Workspace (Session Context Item) Management API Endpoints ---
@main_bp.route("/api/sessions/<session_id>/workspace/items", methods=["GET"])
@async_to_sync_in_flask
async def list_workspace_items_route(session_id: str):
    """Lists all workspace items for a given session using LLMCore."""
    if not llmcore_instance: return jsonify({"error": "LLM service not available."}), 503
    try:
        items = await llmcore_instance.get_session_context_items(session_id)
        return jsonify([item.model_dump(mode="json") for item in items])
    except SessionNotFoundError:
        return jsonify({"error": "Session not found."}), 404
    except LLMCoreError as e:
        logger.error(f"Error listing workspace items for session {session_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to list workspace items: {str(e)}"}), 500

@main_bp.route("/api/sessions/<session_id>/workspace/items/<item_id>", methods=["GET"])
@async_to_sync_in_flask
async def get_workspace_item_route(session_id: str, item_id: str):
    """Gets a specific workspace item by its ID using LLMCore."""
    if not llmcore_instance: return jsonify({"error": "LLM service not available."}), 503
    try:
        item = await llmcore_instance.get_context_item(session_id, item_id)
        if item:
            return jsonify(item.model_dump(mode="json"))
        else:
            return jsonify({"error": "Workspace item not found."}), 404
    except SessionNotFoundError:
        return jsonify({"error": "Session not found."}), 404
    except LLMCoreError as e:
        logger.error(f"Error getting workspace item {item_id} for session {session_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to get workspace item: {str(e)}"}), 500

@main_bp.route("/api/sessions/<session_id>/workspace/add_text", methods=["POST"])
@async_to_sync_in_flask
async def add_text_to_workspace_route(session_id: str):
    """Adds a text snippet as a workspace item using LLMCore."""
    if not llmcore_instance: return jsonify({"error": "LLM service not available."}), 503
    data = request.json
    if not data or "content" not in data: return jsonify({"error": "Missing 'content'."}), 400
    content = data["content"]
    item_id = data.get("item_id")
    try:
        added_item = await llmcore_instance.add_text_context_item(session_id, content, item_id=item_id)
        return jsonify(added_item.model_dump(mode="json")), 201
    except SessionNotFoundError:
        return jsonify({"error": "Session not found."}), 404
    except LLMCoreError as e:
        logger.error(f"Error adding text to workspace for session {session_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to add text to workspace: {str(e)}"}), 500

@main_bp.route("/api/sessions/<session_id>/workspace/add_file", methods=["POST"])
@async_to_sync_in_flask
async def add_file_to_workspace_route(session_id: str):
    """Adds a server-side file's content as a workspace item using LLMCore."""
    if not llmcore_instance: return jsonify({"error": "LLM service not available."}), 503
    data = request.json
    if not data or "file_path" not in data: return jsonify({"error": "Missing 'file_path'."}), 400
    file_path = data["file_path"]
    item_id = data.get("item_id")
    try:
        added_item = await llmcore_instance.add_file_context_item(session_id, file_path, item_id=item_id)
        return jsonify(added_item.model_dump(mode="json")), 201
    except FileNotFoundError:
        return jsonify({"error": f"File not found at server path: {file_path}"}), 404
    except SessionNotFoundError:
        return jsonify({"error": "Session not found."}), 404
    except (LLMCoreError, StorageError) as e: # StorageError if file reading fails internally
        logger.error(f"Error adding file to workspace for session {session_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to add file to workspace: {str(e)}"}), 500

@main_bp.route("/api/sessions/<session_id>/workspace/items/<item_id>", methods=["DELETE"])
@async_to_sync_in_flask
async def remove_workspace_item_route(session_id: str, item_id: str):
    """Removes a workspace item by its ID using LLMCore."""
    if not llmcore_instance: return jsonify({"error": "LLM service not available."}), 503
    try:
        success = await llmcore_instance.remove_context_item(session_id, item_id)
        if success:
            return jsonify({"message": f"Workspace item '{item_id}' removed."})
        else:
            return jsonify({"error": "Workspace item not found or could not be removed."}), 404
    except SessionNotFoundError:
        return jsonify({"error": "Session not found."}), 404
    except LLMCoreError as e:
        logger.error(f"Error removing workspace item {item_id} for session {session_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to remove workspace item: {str(e)}"}), 500

# --- Context Preview API Endpoint ---
@main_bp.route("/api/sessions/<session_id>/context/preview", methods=["POST"])
@async_to_sync_in_flask
async def preview_context_route(session_id: str):
    """Previews the context that would be sent to the LLM using LLMCore."""
    if not llmcore_instance: return jsonify({"error": "LLM service not available."}), 503
    data = request.json
    current_query = data.get("current_query") if data else None
    staged_items_from_js = data.get("staged_items", []) if data else []

    try:
        explicitly_staged_items_for_core = await _resolve_staged_items_for_core(
            staged_items_from_js, session_id
        )

        preview_details_dict = await llmcore_instance.preview_context_for_chat(
            current_user_query=current_query or "", # Must be a string
            session_id=session_id,
            system_message=flask_session.get('system_message'),
            provider_name=flask_session.get('current_provider_name'),
            model_name=flask_session.get('current_model_name'),
            explicitly_staged_items=explicitly_staged_items_for_core,
            enable_rag=flask_session.get('rag_enabled', False),
            rag_collection_name=flask_session.get('rag_collection_name'),
            rag_retrieval_k=flask_session.get('rag_k_value'),
            rag_metadata_filter=flask_session.get('rag_filter'),
            prompt_template_values=flask_session.get('prompt_template_values', {})
        )
        return jsonify(preview_details_dict) # Already a dict from model_dump
    except SessionNotFoundError:
        return jsonify({"error": "Session not found."}), 404
    except LLMCoreError as e:
        logger.error(f"Error generating context preview for session {session_id}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to generate context preview: {str(e)}"}), 500
    except Exception as e_resolve_preview: # Catch errors from _resolve_staged_items_for_core too
        logger.error(f"Error resolving context for preview in session {session_id}: {e_resolve_preview}", exc_info=True)
        return jsonify({"error": f"Failed to process context for preview: {str(e_resolve_preview)}"}), 500


# --- RAG Settings and Search API Endpoints ---
@main_bp.route("/api/rag/collections", methods=["GET"])
@async_to_sync_in_flask
async def get_rag_collections_route():
    """Lists available RAG collections from LLMCore."""
    if not llmcore_instance: return jsonify({"error": "LLM service not available."}), 503
    try:
        collections = await llmcore_instance.list_rag_collections()
        return jsonify(collections)
    except VectorStorageError as e_vs:
        logger.error(f"VectorStorageError listing RAG collections: {e_vs}", exc_info=True)
        return jsonify({"error": f"Failed to access RAG collections storage: {str(e_vs)}"}), 500
    except LLMCoreError as e: # Broader LLMCore error if list_rag_collections itself fails for other reasons
        logger.error(f"Error listing RAG collections: {e}", exc_info=True)
        return jsonify({"error": f"Failed to list RAG collections: {str(e)}"}), 500
    except Exception as e_unexp: # Catch-all for truly unexpected issues
        logger.error(f"Unexpected error listing RAG collections: {e_unexp}", exc_info=True)
        return jsonify({"error": "An unexpected server error occurred while listing RAG collections."}), 500


@main_bp.route("/api/settings/rag/update", methods=["POST"])
def update_rag_settings_route():
    """Updates RAG settings in the Flask session."""
    data = request.json
    if not data: return jsonify({"error": "No data provided."}), 400

    flask_session['rag_enabled'] = data.get('enabled', flask_session.get('rag_enabled', False))
    flask_session['rag_collection_name'] = data.get('collectionName', flask_session.get('rag_collection_name'))
    flask_session['rag_k_value'] = data.get('kValue', flask_session.get('rag_k_value', 3))

    filter_input = data.get('filter') # This comes from JSON.stringify on client, or is null
    if isinstance(filter_input, dict) and filter_input: # If it's already a non-empty dict
        flask_session['rag_filter'] = filter_input
    elif filter_input is None or (isinstance(filter_input, dict) and not filter_input) : # Explicitly null or empty dict
        flask_session['rag_filter'] = None
    # No need to parse from string here, as client sends object or null
    else:
        logger.warning(f"Received RAG filter of unexpected type or structure: {filter_input}. Storing None.")
        flask_session['rag_filter'] = None


    logger.info(f"Flask session RAG settings updated: Enabled={flask_session['rag_enabled']}, "
                f"Collection={flask_session['rag_collection_name']}, K={flask_session['rag_k_value']}, "
                f"Filter={flask_session['rag_filter']}")

    return jsonify({
        "message": "RAG settings updated in session.",
        "rag_settings": {
            "enabled": flask_session['rag_enabled'],
            "collection_name": flask_session['rag_collection_name'],
            "k_value": flask_session['rag_k_value'],
            "filter": flask_session['rag_filter'],
        }
    })

@main_bp.route("/api/rag/direct_search", methods=["POST"])
@async_to_sync_in_flask
async def direct_rag_search_route():
    """Performs a direct RAG search using LLMCore."""
    if not llmcore_instance:
        return jsonify({"error": "LLM service not available."}), 503

    data = request.json
    if not data or "query" not in data:
        return jsonify({"error": "Missing 'query' in request."}), 400

    query = data["query"]
    collection_name = data.get("collection_name", flask_session.get('rag_collection_name'))
    k_value = data.get("k", flask_session.get('rag_k_value', 3))
    metadata_filter = data.get("filter", flask_session.get('rag_filter')) # Expects dict or null

    if not collection_name:
        # Try to get LLMCore's configured default if not in session or request
        default_llmcore_collection = llmcore_instance.config.get("storage.vector.default_collection") if llmcore_instance.config else None
        if not default_llmcore_collection:
             return jsonify({"error": "No RAG collection specified and no default LLMCore collection configured."}), 400
        collection_name = default_llmcore_collection
        logger.info(f"No collection specified for direct RAG search, using LLMCore default: {collection_name}")

    logger.info(f"Direct RAG search: Query='{query[:50]}...', Collection='{collection_name}', K={k_value}, Filter={metadata_filter}")

    try:
        search_results: List[LLMCoreContextDocument] = await llmcore_instance.search_vector_store(
            query=query,
            k=int(k_value), # Ensure k is int
            collection_name=collection_name,
            filter_metadata=metadata_filter # Pass filter as is (dict or None)
        )
        results_dict_list = [doc.model_dump(mode="json") for doc in search_results]
        return jsonify(results_dict_list)
    except (VectorStorageError, LLMCoreError) as e:
        logger.error(f"Error during direct RAG search: {e}", exc_info=True)
        return jsonify({"error": f"Direct RAG search failed: {str(e)}"}), 500
    except ValueError as ve: # For int(k_value)
        logger.error(f"Invalid K value for direct RAG search: {k_value} - {ve}", exc_info=True)
        return jsonify({"error": f"Invalid K value for search: {str(ve)}"}), 400
    except Exception as e: # Catch-all for other unexpected errors
        logger.error(f"Unexpected error during direct RAG search: {e}", exc_info=True)
        return jsonify({"error": "An unexpected server error occurred during RAG search."}), 500


# --- LLM Settings API Endpoints ---
@main_bp.route("/api/llm/providers", methods=["GET"])
@async_to_sync_in_flask
async def get_llm_providers_route():
    """Lists available LLM providers from LLMCore."""
    if not llmcore_instance: return jsonify({"error": "LLM service not available."}), 503
    try:
        providers = llmcore_instance.get_available_providers()
        return jsonify(providers)
    except LLMCoreError as e:
        logger.error(f"Error listing LLM providers: {e}", exc_info=True)
        return jsonify({"error": f"Failed to list LLM providers: {str(e)}"}), 500

@main_bp.route("/api/llm/providers/<provider_name>/models", methods=["GET"])
@async_to_sync_in_flask
async def get_llm_models_route(provider_name: str):
    """Lists models for a specific LLM provider from LLMCore."""
    if not llmcore_instance: return jsonify({"error": "LLM service not available."}), 503
    try:
        models = llmcore_instance.get_models_for_provider(provider_name)
        return jsonify(models)
    except LLMCoreError as e: # Catch ConfigError or ProviderError from get_models_for_provider
        logger.error(f"Error listing models for provider {provider_name}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to list models for provider '{provider_name}': {str(e)}"}), 500

@main_bp.route("/api/settings/llm/update", methods=["POST"])
def update_llm_settings_route():
    """Updates LLM provider and model in the Flask session."""
    data = request.json
    if not data: return jsonify({"error": "No data provided."}), 400

    new_provider_name = data.get('provider_name')
    new_model_name = data.get('model_name') # Can be empty string or null from JS

    if new_provider_name:
        flask_session['current_provider_name'] = new_provider_name
        # If new_model_name is empty string or null, set Flask session to None
        # so that the default model for the new provider is picked up later if needed.
        flask_session['current_model_name'] = new_model_name if new_model_name else None
        logger.info(f"Flask session LLM settings updated: Provider={new_provider_name}, Model={flask_session['current_model_name']}")

        # If model became None after update, try to set to provider's default
        if flask_session['current_model_name'] is None and llmcore_instance and llmcore_instance.config:
            provider_default_model = llmcore_instance.config.get(f"providers.{new_provider_name}.default_model")
            flask_session['current_model_name'] = provider_default_model
            logger.info(f"Model was empty for '{new_provider_name}', set to provider's default: {provider_default_model}")

        return jsonify({
            "message": "LLM settings updated in session.",
            "llm_settings": {
                "provider_name": flask_session['current_provider_name'],
                "model_name": flask_session['current_model_name'],
            }
        })
    else:
        return jsonify({"error": "Provider name is required to update LLM settings."}), 400


@main_bp.route("/api/settings/system_message", methods=["GET"])
def get_system_message_route():
    """Retrieves the current system message from the Flask session."""
    system_msg = flask_session.get('system_message', "")
    return jsonify({"system_message": system_msg})

@main_bp.route("/api/settings/system_message/update", methods=["POST"])
def update_system_message_route():
    """Updates the system message in the Flask session."""
    data = request.json
    new_system_message = data.get('system_message', "") if data else "" # Default to empty string if no data or key

    flask_session['system_message'] = new_system_message
    flask_session.modified = True # Ensure session is saved if only this changed
    logger.info(f"Flask session system_message updated: '{new_system_message[:100]}...'")
    return jsonify({
        "message": "System message updated in session.",
        "system_message": new_system_message
    })

# --- Prompt Template Values API Endpoints ---
@main_bp.route("/api/settings/prompt_template_values", methods=["GET"])
def get_prompt_template_values_route():
    """Retrieves the current RAG prompt template values from the Flask session."""
    values = flask_session.get('prompt_template_values', {})
    return jsonify({"prompt_template_values": values})

@main_bp.route("/api/settings/prompt_template_values/update", methods=["POST"])
def update_prompt_template_value_route():
    """Adds or updates a single key-value pair for RAG prompt templates in Flask session."""
    data = request.json
    if not data or "key" not in data or "value" not in data: # Check for presence of key and value
        return jsonify({"error": "Missing 'key' or 'value' for prompt template update."}), 400

    key = str(data["key"]) # Ensure key is string
    value = str(data["value"]) # Ensure value is string

    if 'prompt_template_values' not in flask_session or not isinstance(flask_session['prompt_template_values'], dict):
        flask_session['prompt_template_values'] = {}

    flask_session['prompt_template_values'][key] = value
    flask_session.modified = True
    logger.info(f"Prompt template value updated/added: {key} = {value}")
    return jsonify({"prompt_template_values": flask_session['prompt_template_values']})

@main_bp.route("/api/settings/prompt_template_values/delete_key", methods=["POST"])
def delete_prompt_template_value_route():
    """Deletes a specific key from RAG prompt template values in Flask session."""
    data = request.json
    if not data or "key" not in data:
        return jsonify({"error": "Missing 'key' for prompt template value deletion."}), 400

    key_to_delete = str(data["key"]) # Ensure key is string
    if 'prompt_template_values' in flask_session and isinstance(flask_session['prompt_template_values'], dict):
        if key_to_delete in flask_session['prompt_template_values']:
            del flask_session['prompt_template_values'][key_to_delete]
            flask_session.modified = True
            logger.info(f"Prompt template value deleted for key: {key_to_delete}")
        else:
            logger.warning(f"Attempted to delete non-existent prompt template key: {key_to_delete}")
    return jsonify({"prompt_template_values": flask_session.get('prompt_template_values', {})})

@main_bp.route("/api/settings/prompt_template_values/clear_all", methods=["POST"])
def clear_all_prompt_template_values_route():
    """Clears all RAG prompt template values from Flask session."""
    flask_session['prompt_template_values'] = {}
    flask_session.modified = True
    logger.info("All prompt template values cleared from session.")
    return jsonify({"prompt_template_values": {}})


# --- Data Ingestion API Endpoint ---
def _get_apykatu_config_for_ingestion(collection_name_override: str) -> Optional[ApykatuAppConfig]: # type: ignore
    """
    Prepares ApykatuAppConfig for an ingestion run.
    It fetches LLMCore's [apykatu] settings and overrides db path and collection name.
    """
    if not llmcore_instance or not llmcore_instance.config:
        logger.error("LLMCore instance or its config not available for Apykatu config preparation.")
        return None
    if not APYKATU_AVAILABLE:
        logger.error("Apykatu library not available for config preparation.")
        return None

    apykatu_settings_from_llmcore_raw = llmcore_instance.config.get('apykatu', {})
    apykatu_settings_from_llmcore: Dict[str, Any]
    if not isinstance(apykatu_settings_from_llmcore_raw, dict):
        try:
            # If it's a Confy sub-config object, convert to dict
            apykatu_settings_from_llmcore = apykatu_settings_from_llmcore_raw.as_dict()
        except AttributeError:
            logger.error(f"LLMCore's 'apykatu' config section is not a dictionary or Confy object. Type: {type(apykatu_settings_from_llmcore_raw)}")
            apykatu_settings_from_llmcore = {} # Fallback to empty dict
    else:
        apykatu_settings_from_llmcore = apykatu_settings_from_llmcore_raw


    logger.debug(f"Apykatu settings from LLMCore for ingestion: {apykatu_settings_from_llmcore}")

    try:
        # Assuming Apykatu has a way to load config from a dictionary or apply overrides
        # This part depends heavily on Apykatu's config loading mechanism
        from apykatu.config.confy_loader import load_app_config_with_confy as load_apykatu_config

        # Load Apykatu's own defaults first, then apply LLMCore's overrides
        final_apykatu_config_tuple = load_apykatu_config(
            cli_config_file_path=None, # Apykatu won't load its own file
            cli_overrides=apykatu_settings_from_llmcore # Apply LLMCore's apykatu section
        )
        final_apykatu_config: ApykatuAppConfig = final_apykatu_config_tuple[0] # type: ignore

    except ApykatuConfigError as e_conf: # type: ignore
        logger.error(f"ApykatuConfigError during Apykatu config loading: {e_conf}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error loading Apykatu config: {e}", exc_info=True)
        return None

    # Override DB path and collection name from LLMCore's main vector store config
    llmcore_vector_db_path = llmcore_instance.config.get("storage.vector.path")
    if llmcore_vector_db_path:
        final_apykatu_config.database.path = Path(llmcore_vector_db_path).expanduser().resolve()
    else:
        logger.warning("LLMCore's storage.vector.path is not set. Apykatu will use its default DB path if not overridden elsewhere in its own config.")

    final_apykatu_config.database.collection_name = collection_name_override # Crucial override
    logger.info(f"Apykatu config prepared for ingestion. Collection: '{collection_name_override}', DB Path: '{final_apykatu_config.database.path}'")
    return final_apykatu_config


async def stream_file_ingestion_progress(uploaded_files: List[Any], collection_name: str, temp_dir: Path, apykatu_cfg: ApykatuAppConfig) -> AsyncGenerator[str, None]: # type: ignore
    """
    Async generator to process uploaded files one by one and stream SSE progress.
    """
    if not llmcore_instance:
        yield f"data: {json.dumps({'type': 'error', 'error': 'LLM service not available for ingestion.'})}\n\n"
        yield f"data: {json.dumps({'type': 'end'})}\n\n"
        return

    total_files = len(uploaded_files)
    overall_chunks_added = 0
    overall_files_processed_successfully = 0
    overall_files_with_errors = 0
    all_error_messages: List[str] = []

    for i, uploaded_file_storage in enumerate(uploaded_files):
        filename = "unknown_file"
        file_status = "pending"
        file_error_msg: Optional[str] = None
        chunks_this_file = 0
        try:
            if not uploaded_file_storage or not uploaded_file_storage.filename:
                logger.warning(f"Skipping invalid file upload at index {i}.")
                file_error_msg = "Invalid file upload object."
                overall_files_with_errors +=1
                all_error_messages.append(f"File {i+1}: {file_error_msg}")
                yield f"data: {json.dumps({'type': 'file_end', 'filename': 'N/A', 'file_index': i, 'total_files': total_files, 'status': 'error', 'error_message': file_error_msg, 'chunks_added': 0})}\n\n"
                await asyncio.sleep(0.01) # Ensure message is sent
                continue

            filename = secure_filename(uploaded_file_storage.filename)
            yield f"data: {json.dumps({'type': 'file_start', 'filename': filename, 'file_index': i, 'total_files': total_files})}\n\n"
            await asyncio.sleep(0.01)

            temp_file_path = temp_dir / filename
            uploaded_file_storage.save(str(temp_file_path)) # Ensure path is string
            logger.info(f"Processing uploaded file ({i+1}/{total_files}): {filename} for collection '{collection_name}'")

            # Call Apykatu's API to process the file
            processed_chunks, api_stats_obj = await apykatu_process_file_path_api( # type: ignore
                file_path=temp_file_path, config=apykatu_cfg, generate_embeddings=True
            )

            if api_stats_obj.error_messages: # type: ignore
                file_status = "error"
                file_error_msg = "; ".join(api_stats_obj.error_messages) # type: ignore
                all_error_messages.extend([f"File '{filename}': {e}" for e in api_stats_obj.error_messages]) # type: ignore
                overall_files_with_errors +=1
            else:
                if processed_chunks: # type: ignore
                    # Convert ApykatuProcessedChunk to LLMCore's expected format for add_documents_to_vector_store
                    docs_for_llmcore = []
                    for pc in processed_chunks: # type: ignore
                        # Ensure embedding data is present and correct
                        if pc.embedding_data and pc.embedding_data.get("vector"): # type: ignore
                            # Adapt metadata as needed. Apykatu's metadata_from_apykatu might be a Pydantic model.
                            meta_to_store = pc.metadata_from_apykatu.model_dump() if hasattr(pc.metadata_from_apykatu, 'model_dump') else pc.metadata_from_apykatu # type: ignore
                            docs_for_llmcore.append({
                                "id": pc.semantiscan_chunk_id, # type: ignore
                                "content": pc.content_text, # type: ignore
                                "embedding": pc.embedding_data["vector"], # type: ignore
                                "metadata": meta_to_store
                            })
                        else:
                            logger.warning(f"Chunk {pc.semantiscan_chunk_id} from file '{filename}' missing embedding. Skipping.") # type: ignore

                    if docs_for_llmcore:
                        # Use LLMCore's method to add to its configured vector store
                        # This assumes Apykatu's config for DB path/collection was aligned with LLMCore's
                        # by _get_apykatu_config_for_ingestion.
                        added_ids = await llmcore_instance.add_documents_to_vector_store(
                            documents=docs_for_llmcore, # type: ignore
                            collection_name=collection_name # Use the target collection name
                        )
                        chunks_this_file = len(added_ids)
                        overall_chunks_added += chunks_this_file
                        file_status = "success"
                        overall_files_processed_successfully +=1
                    else:
                        file_status = "warning_no_chunks"
                        file_error_msg = "No processable chunks with embeddings found."
                        overall_files_with_errors +=1 # Count as error if no chunks added
                        all_error_messages.append(f"File '{filename}': {file_error_msg}")
                else: # No chunks produced by Apykatu
                    file_status = "warning_no_chunks"
                    file_error_msg = "Apykatu processed the file but produced no chunks."
                    overall_files_with_errors +=1 # Count as error
                    all_error_messages.append(f"File '{filename}': {file_error_msg}")

            yield f"data: {json.dumps({'type': 'file_end', 'filename': filename, 'file_index': i, 'total_files': total_files, 'status': file_status, 'chunks_added': chunks_this_file, 'error_message': file_error_msg})}\n\n"
            await asyncio.sleep(0.01)

        except Exception as e_file:
            logger.error(f"Error processing file '{filename}' during ingestion stream: {e_file}", exc_info=True)
            file_error_msg = str(e_file)
            overall_files_with_errors +=1
            all_error_messages.append(f"File '{filename}': {file_error_msg}")
            yield f"data: {json.dumps({'type': 'file_end', 'filename': filename, 'file_index': i, 'total_files': total_files, 'status': 'error', 'error_message': file_error_msg, 'chunks_added': 0})}\n\n"
            await asyncio.sleep(0.01)

    # Final summary event
    summary_payload = {
        "total_files_submitted": total_files,
        "files_processed_successfully": overall_files_processed_successfully,
        "files_with_errors": overall_files_with_errors,
        "total_chunks_added_to_db": overall_chunks_added,
        "collection_name": collection_name,
        "error_messages": all_error_messages,
        "status": "success" if overall_files_with_errors == 0 and total_files > 0 else "completed_with_errors" if total_files > 0 else "no_files_processed"
    }
    yield f"data: {json.dumps({'type': 'ingestion_complete', 'summary': summary_payload})}\n\n"
    yield f"data: {json.dumps({'type': 'end'})}\n\n" # Ensure stream ends properly


@main_bp.route("/api/ingest", methods=["POST"])
def ingest_data_route() -> Response:
    """
    Handles data ingestion requests (file, directory ZIP, Git URL).
    Uses Apykatu for processing. LLMCore's vector store is used via Apykatu's config.
    All ingestion types now attempt to stream progress via SSE.
    """
    if not llmcore_instance:
        def error_stream_llm_unavailable():
            yield f"data: {json.dumps({'type': 'error', 'error': 'LLM service not available.'})}\n\n"
            yield f"data: {json.dumps({'type': 'end'})}\n\n"
        return Response(stream_with_context(error_stream_llm_unavailable()), mimetype='text/event-stream')

    if not APYKATU_AVAILABLE:
        def error_stream_apykatu_unavailable():
            yield f"data: {json.dumps({'type': 'error', 'error': 'Apykatu ingestion service not available.'})}\n\n"
            yield f"data: {json.dumps({'type': 'end'})}\n\n"
        return Response(stream_with_context(error_stream_apykatu_unavailable()), mimetype='text/event-stream')

    ingest_type = request.form.get("ingest_type")
    collection_name = request.form.get("collection_name")

    if not ingest_type or not collection_name:
        def error_stream_missing_params():
            yield f"data: {json.dumps({'type': 'error', 'error': 'Missing ingest_type or collection_name.'})}\n\n"
            yield f"data: {json.dumps({'type': 'end'})}\n\n"
        return Response(stream_with_context(error_stream_missing_params()), status=400, mimetype='text/event-stream')

    logger.info(f"Received ingestion request. Type: {ingest_type}, Collection: {collection_name}")

    apykatu_cfg = _get_apykatu_config_for_ingestion(collection_name)
    if not apykatu_cfg:
        def error_stream_apykatu_cfg():
            yield f"data: {json.dumps({'type': 'error', 'error': 'Failed to prepare Apykatu configuration.'})}\n\n"
            yield f"data: {json.dumps({'type': 'end'})}\n\n"
        return Response(stream_with_context(error_stream_apykatu_cfg()), status=500, mimetype='text/event-stream')

    # run_async_generator_synchronously is defined globally in this file now.

    if ingest_type == "file":
        uploaded_files = request.files.getlist("files[]")
        if not uploaded_files or not any(f.filename for f in uploaded_files): # Check if any file has a name
            def error_stream_no_files():
                yield f"data: {json.dumps({'type': 'error', 'error': 'No files provided for file ingestion.'})}\n\n"
                yield f"data: {json.dumps({'type': 'end'})}\n\n"
            return Response(stream_with_context(error_stream_no_files()), status=400, mimetype='text/event-stream')

        temp_dir_obj = tempfile.TemporaryDirectory(prefix="llmchat_web_ingest_files_")
        temp_dir_path = Path(temp_dir_obj.name)

        def file_ingestion_stream_generator():
            try:
                # Pass temp_dir_path to the async generator
                for event in run_async_generator_synchronously(stream_file_ingestion_progress, uploaded_files, collection_name, temp_dir_path, apykatu_cfg):
                    yield event
            finally:
                temp_dir_obj.cleanup() # Ensure cleanup
                logger.info(f"Cleaned up temporary directory for file ingestion: {temp_dir_path}")

        return Response(stream_with_context(file_ingestion_stream_generator()), mimetype='text/event-stream')


    async def stream_other_ingestion_types_sse_async_gen() -> AsyncGenerator[str, None]:
        nonlocal collection_name # Ensure collection_name is accessible from outer scope
        overall_status = "error" # Default to error
        summary_message = "Ingestion type not fully implemented for detailed SSE progress yet."
        details: Dict[str, Any] = {"ingest_type": ingest_type}

        # Use a context manager for the temporary directory
        with tempfile.TemporaryDirectory(prefix="llmchat_web_ingest_other_") as temp_dir_str:
            temp_dir_other = Path(temp_dir_str)
            try:
                yield f"data: {json.dumps({'type': 'ingestion_start', 'ingest_type': ingest_type, 'collection_name': collection_name})}\n\n"
                await asyncio.sleep(0.01) # Ensure message is sent

                if ingest_type == "dir_zip":
                    zip_file_storage = request.files.get("zip_file")
                    if not zip_file_storage or not zip_file_storage.filename:
                        summary_message = "No ZIP file provided."
                        raise ValueError(summary_message)

                    filename = secure_filename(zip_file_storage.filename)
                    temp_zip_path = temp_dir_other / filename
                    zip_file_storage.save(str(temp_zip_path)) # Ensure path is string
                    extracted_dir_path = temp_dir_other / "unzipped_content"
                    extracted_dir_path.mkdir()
                    with zipfile.ZipFile(temp_zip_path, 'r') as zip_ref:
                        zip_ref.extractall(extracted_dir_path)
                    logger.info(f"Extracted ZIP '{filename}' to '{extracted_dir_path}'. Starting Apykatu pipeline.")

                    pipeline = IngestionPipeline(config=apykatu_cfg, progress_context=None) # type: ignore
                    repo_name = request.form.get("repo_name", extracted_dir_path.name)
                    # Apykatu's pipeline.run is async
                    await pipeline.run(repo_path=extracted_dir_path, repo_name=repo_name, git_ref="HEAD", mode='snapshot') # type: ignore
                    summary_message = f"Directory (ZIP) '{filename}' ingestion pipeline completed."
                    overall_status = "success" # Assume success if pipeline.run doesn't raise
                    # These details would ideally come from Apykatu's pipeline.run if it provided them
                    details['files_processed_successfully'] = "N/A (dir)" # Placeholder
                    details['total_chunks_added_to_db'] = "N/A (dir)" # Placeholder


                elif ingest_type == "git":
                    if not GITPYTHON_AVAILABLE:
                        summary_message = "GitPython library not available."
                        raise ImportError(summary_message)
                    git_url = request.form.get("git_url")
                    repo_name_for_git = request.form.get("repo_name")
                    git_ref = request.form.get("git_ref") or "HEAD" # Default to HEAD if not provided
                    if not git_url or not repo_name_for_git:
                        summary_message = "Missing Git URL or repository name."
                        raise ValueError(summary_message)

                    cloned_repo_path = temp_dir_other / repo_name_for_git
                    logger.info(f"Cloning Git repo from '{git_url}' (ref: {git_ref}) to '{cloned_repo_path}'")
                    # Git clone is synchronous, run in thread for async context
                    await asyncio.to_thread(git.Repo.clone_from, git_url, str(cloned_repo_path), branch=git_ref if git_ref != "HEAD" else None, depth=1) # type: ignore

                    logger.info(f"Git repo cloned. Starting Apykatu pipeline for '{repo_name_for_git}'.")
                    pipeline = IngestionPipeline(config=apykatu_cfg, progress_context=None) # type: ignore
                    await pipeline.run(repo_path=cloned_repo_path, repo_name=repo_name_for_git, git_ref=git_ref, mode='snapshot') # type: ignore
                    summary_message = f"Git repository '{repo_name_for_git}' (ref: {git_ref}) ingestion pipeline completed."
                    overall_status = "success"
                    details['files_processed_successfully'] = "N/A (git)"
                    details['total_chunks_added_to_db'] = "N/A (git)"

                else:
                    summary_message = f"Unsupported ingestion type for streaming: {ingest_type}"
                    raise ValueError(summary_message)

            except Exception as e_other:
                logger.error(f"Error during '{ingest_type}' ingestion stream: {e_other}", exc_info=True)
                summary_message = str(e_other)
                overall_status = "error" # Ensure status is error
                details['error_message'] = summary_message
            # No finally temp_dir_other_mgr.cleanup() needed due to 'with' statement

            # Construct final summary payload
            final_summary_payload = {
                "message": summary_message,
                "status": overall_status,
                "collection_name": collection_name,
                "details": details,
                "total_files_submitted": "N/A" if ingest_type != "file" else 0, # Placeholder for non-file
                "files_processed_successfully": details.get('files_processed_successfully', "N/A"),
                "files_with_errors": details.get('files_with_errors', "N/A" if overall_status == "success" else "All"), # Simplified
                "total_chunks_added_to_db": details.get('total_chunks_added_to_db', "N/A"),
                "error_messages": [details['error_message']] if 'error_message' in details else []
            }
            yield f"data: {json.dumps({'type': 'ingestion_complete', 'summary': final_summary_payload})}\n\n"
            yield f"data: {json.dumps({'type': 'end'})}\n\n"

    # Use run_async_generator_synchronously for dir_zip and git types as well
    return Response(stream_with_context(run_async_generator_synchronously(stream_other_ingestion_types_sse_async_gen)), mimetype='text/event-stream')
