# llmchat_web/routes/chat_routes.py
"""
Flask routes for chat functionalities in the llmchat-web application.
Handles sending messages, streaming responses, and related chat operations.
"""
import asyncio
import json
import logging
import uuid # For generating unique IDs if needed for new items
from typing import Any, AsyncGenerator, Dict, Optional, List, Union
from pathlib import Path # For potential path operations if context items involve files

from flask import Response, jsonify, request, stream_with_context
from flask import session as flask_session

# Import the specific blueprint defined in the routes package's __init__.py
from . import chat_bp

# Import shared components from the main app module (llmchat_web.app)
from ..app import (
    llmcore_instance,
    async_to_sync_in_flask,
    get_context_usage_info,
    get_current_web_session_id,
    # set_current_web_session_id is not directly used here but good to be aware of
    logger as app_logger # Main app logger
)

# Import specific LLMCore exceptions and models relevant to chat
from llmcore import (
    ContextLengthError, LLMCoreError, ProviderError,
    SessionNotFoundError,
    Message as LLMCoreMessage, Role as LLMCoreRole,
    ContextItem as LLMCoreContextItem, ContextItemType as LLMCoreContextItemType
    # ContextDocument is more for RAG/workspace, but ContextItem is used for staging
)

# Configure a local logger for this specific routes module
logger = logging.getLogger("llmchat_web.routes.chat")
if not logger.handlers and app_logger:
    logger.parent = logging.getLogger("llmchat_web.routes")
    if logger.parent and logger.parent.level:
        logger.setLevel(logger.parent.level)
    else:
        logger.setLevel(app_logger.level if app_logger else logging.DEBUG)


# --- Helper Functions for Chat ---

async def _get_last_assistant_message_id(session_id: Optional[str]) -> Optional[str]:
    """
    Helper to get the ID of the last assistant message in a given LLMCore session.
    Used to associate a streamed response with a persistent message ID.

    Args:
        session_id: The ID of the LLMCore session to inspect.

    Returns:
        The ID of the last assistant message, or None if not found or an error occurs.
    """
    if not llmcore_instance or not session_id:
        logger.warning(f"_get_last_assistant_message_id called with no llmcore_instance or session_id ({session_id})")
        return None
    try:
        session_obj = await llmcore_instance.get_session(session_id)
        if session_obj and session_obj.messages:
            for msg in reversed(session_obj.messages):
                if msg.role == LLMCoreRole.ASSISTANT:
                    return msg.id
        logger.debug(f"No assistant message found in session {session_id} to get ID from.")
    except SessionNotFoundError:
        logger.warning(f"Session {session_id} not found while trying to get last assistant message ID.")
    except LLMCoreError as e:
        logger.error(f"LLMCoreError getting last assistant message ID for session {session_id}: {e}")
    except Exception as e_unexp:
        logger.error(f"Unexpected error in _get_last_assistant_message_id for session {session_id}: {e_unexp}", exc_info=True)
    return None

async def _resolve_staged_items_for_core(
    staged_items_from_js: List[Dict[str, Any]],
    session_id_for_staging: Optional[str]
) -> List[Union[LLMCoreMessage, LLMCoreContextItem]]:
    """
    Resolves items from the client's active_context_specification (staged items)
    into LLMCoreMessage or LLMCoreContextItem objects suitable for LLMCore.

    Args:
        staged_items_from_js: A list of dictionaries representing items staged on the client.
                              Each dictionary should conform to the structure expected from `custom.js`.
        session_id_for_staging: The current LLMCore session ID, used to retrieve existing
                                messages or workspace items if referenced.

    Returns:
        A list of resolved LLMCoreMessage or LLMCoreContextItem objects.
    """
    if not llmcore_instance:
        logger.error("_resolve_staged_items_for_core called but llmcore_instance is None.")
        return []

    explicitly_staged_items: List[Union[LLMCoreMessage, LLMCoreContextItem]] = []
    if not staged_items_from_js:
        return explicitly_staged_items

    logger.debug(f"Resolving {len(staged_items_from_js)} staged items from JS for session {session_id_for_staging}.")

    for js_item in staged_items_from_js:
        item_type_str = js_item.get('type')
        item_content = js_item.get('content') # For text_content, or file_content if pre-loaded
        item_path = js_item.get('path') # For file_content
        item_id_ref = js_item.get('id_ref') # For message_history or workspace_item
        # Generate a unique ID for this specific staged instance if not inherently an existing item
        item_spec_id = js_item.get('spec_item_id', f"staged_{uuid.uuid4().hex[:8]}")
        no_truncate = js_item.get('no_truncate', False) # Option to prevent LLMCore from truncating this item
        resolved_item: Optional[Union[LLMCoreMessage, LLMCoreContextItem]] = None

        try:
            if item_type_str == "message_history" and item_id_ref and session_id_for_staging:
                sess_obj = await llmcore_instance.get_session(session_id_for_staging)
                if sess_obj:
                    resolved_item = next((m for m in sess_obj.messages if m.id == item_id_ref), None)
                    if resolved_item: logger.debug(f"Resolved staged message_history item: {item_id_ref}")
            elif item_type_str == "workspace_item" and item_id_ref and session_id_for_staging:
                resolved_item = await llmcore_instance.get_context_item(session_id_for_staging, item_id_ref)
                if resolved_item: logger.debug(f"Resolved staged workspace_item: {item_id_ref}")
            elif item_type_str == "file_content" and item_path:
                # LLMCore will handle loading the file content from item_path if content is None.
                # Metadata helps identify the item and its properties.
                resolved_item = LLMCoreContextItem(
                    id=item_spec_id, # Use the unique spec_item_id for this staged instance
                    type=LLMCoreContextItemType.USER_FILE,
                    content=item_content, # Pass content if client pre-loaded it, else LLMCore loads from path
                    source_id=item_path, # The actual file path
                    metadata={
                        "filename": Path(item_path).name,
                        "llmchat_web_staged": True, # Mark as staged by web UI
                        "ignore_char_limit": no_truncate # Pass truncation preference
                    }
                )
                logger.debug(f"Created staged file_content item for path: {item_path}")
            elif item_type_str == "text_content" and item_content is not None:
                resolved_item = LLMCoreContextItem(
                    id=item_spec_id, # Use the unique spec_item_id
                    type=LLMCoreContextItemType.USER_TEXT,
                    content=item_content,
                    source_id=item_spec_id, # Source is this item itself
                    metadata={
                        "llmchat_web_staged": True,
                        "ignore_char_limit": no_truncate
                    }
                )
                logger.debug(f"Created staged text_content item with ID: {item_spec_id}")

            if resolved_item:
                explicitly_staged_items.append(resolved_item)
            else:
                logger.warning(f"Could not resolve staged item from JS: Type='{item_type_str}', Ref='{item_id_ref}', Path='{item_path}'. Item details: {js_item}")
        except Exception as e_resolve:
            logger.error(f"Error resolving staged item {js_item}: {e_resolve}", exc_info=True)

    logger.info(f"Successfully resolved {len(explicitly_staged_items)} items for LLMCore explicit staging.")
    return explicitly_staged_items


async def _stream_chat_responses_route_helper(llm_core_chat_params: Dict[str, Any]) -> AsyncGenerator[str, None]:
    """
    Async generator for streaming chat responses using Server-Sent Events (SSE).
    This function encapsulates the call to `llmcore_instance.chat` with `stream=True`
    and formats each chunk of the response as an SSE message. It also handles
    sending metadata like the full response ID and context usage information
    after the stream completes.

    Args:
        llm_core_chat_params: A dictionary of parameters to be passed to `llmcore_instance.chat`.
                              This must include `stream=True`.

    Yields:
        Strings formatted as SSE messages (e.g., "data: {...}\\n\\n").
    """
    if not llmcore_instance:
        logger.error("LLMCore instance not available for streaming chat.")
        yield f"data: {json.dumps({'type': 'error', 'error': 'LLM service not available.'})}\n\n"
        yield f"data: {json.dumps({'type': 'end'})}\n\n" # Ensure stream ends
        return

    last_assistant_message_id: Optional[str] = None
    context_usage_data: Optional[Dict[str, Any]] = None
    session_id_for_meta = llm_core_chat_params.get("session_id")

    logger.debug(f"Starting chat stream for session {session_id_for_meta} with params: {llm_core_chat_params.get('message')[:50]}...")
    try:
        # LLMCore.chat with stream=True returns an AsyncGenerator[str, None]
        response_generator = await llmcore_instance.chat(**llm_core_chat_params) # type: ignore
        async for chunk_content in response_generator:
            yield f"data: {json.dumps({'type': 'chunk', 'content': chunk_content})}\n\n"
            await asyncio.sleep(0.01) # Small sleep to allow other tasks, if any, and ensure chunks are sent

        logger.debug(f"Chat stream completed for session {session_id_for_meta}. Fetching metadata.")
        # After stream completion, fetch metadata
        if session_id_for_meta:
            last_assistant_message_id = await _get_last_assistant_message_id(session_id_for_meta)
            context_usage_data = await get_context_usage_info(session_id_for_meta) # From app.py

        if last_assistant_message_id:
            logger.debug(f"Yielding full_response_id: {last_assistant_message_id} for session {session_id_for_meta}")
            yield f"data: {json.dumps({'type': 'full_response_id', 'message_id': last_assistant_message_id})}\n\n"
        if context_usage_data:
            logger.debug(f"Yielding context_usage data for session {session_id_for_meta}: {context_usage_data}")
            yield f"data: {json.dumps({'type': 'context_usage', 'data': context_usage_data})}\n\n"

    except (ProviderError, ContextLengthError, SessionNotFoundError, LLMCoreError) as e:
        logger.error(f"LLMCore chat error during stream for session {session_id_for_meta}: {e}", exc_info=True)
        yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
    except Exception as e:
        logger.error(f"Unexpected error during chat stream for session {session_id_for_meta}: {e}", exc_info=True)
        yield f"data: {json.dumps({'type': 'error', 'error': 'An unexpected server error occurred during chat.'})}\n\n"
    finally:
        logger.info(f"Ending chat stream for session {session_id_for_meta}.")
        yield f"data: {json.dumps({'type': 'end'})}\n\n"


def run_async_generator_synchronously(async_gen_func: Callable[..., AsyncGenerator[str, None]], *args: Any, **kwargs: Any) -> Any:
    """
    Runs an asynchronous generator function synchronously.
    This is a utility for Flask routes that need to use `stream_with_context`
    with an async generator, especially in environments where Flask runs
    with synchronous workers (like default Gunicorn).

    It creates a new event loop, runs the async generator to completion within that loop,
    and yields its items. Ensures proper cleanup of the created event loop.

    Args:
        async_gen_func: The asynchronous generator function to run.
        *args: Positional arguments to pass to `async_gen_func`.
        **kwargs: Keyword arguments to pass to `async_gen_func`.

    Yields:
        Items from the asynchronous generator.
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    logger.debug(f"Created new event loop for run_async_generator_synchronously of {async_gen_func.__name__}")
    try:
        async_gen = async_gen_func(*args, **kwargs)
        while True:
            try:
                item = loop.run_until_complete(async_gen.__anext__())
                yield item
            except StopAsyncIteration:
                logger.debug(f"Async generator {async_gen_func.__name__} completed.")
                break
            except Exception as e_inner: # Catch errors from within the generator's iteration
                logger.error(f"Error during iteration of async generator {async_gen_func.__name__}: {e_inner}", exc_info=True)
                # Optionally, re-raise or yield an error message if the protocol supports it
                # For SSE, the generator itself should handle yielding error messages.
                break # Stop iteration on error
    finally:
        logger.debug(f"Cleaning up event loop for run_async_generator_synchronously of {async_gen_func.__name__}.")
        try:
            # Gracefully shutdown tasks and async generators in the created loop
            async def _shutdown_loop_tasks(current_loop: asyncio.AbstractEventLoop):
                tasks = [t for t in asyncio.all_tasks(loop=current_loop) if t is not asyncio.current_task(loop=current_loop)]
                if tasks:
                    logger.debug(f"Cancelling {len(tasks)} outstanding tasks in sync generator's loop for {async_gen_func.__name__}.")
                    for task in tasks: task.cancel()
                    await asyncio.gather(*tasks, return_exceptions=True)
                logger.debug(f"Shutting down async generators in sync generator's loop for {async_gen_func.__name__}.")
                await current_loop.shutdown_asyncgens()
            loop.run_until_complete(_shutdown_loop_tasks(loop))
        except Exception as e_shutdown:
            logger.error(f"Error during shutdown of tasks/asyncgens in sync generator's loop for {async_gen_func.__name__}: {e_shutdown}")
        finally:
            loop.close()
            logger.debug(f"Event loop for {async_gen_func.__name__} closed.")
            # If this loop was set as the current loop for the policy, clear it.
            if asyncio.get_event_loop_policy().get_event_loop() is loop:
                asyncio.set_event_loop(None)


# --- Chat Route ---

# Note: The blueprint chat_bp has url_prefix='/api/chat'.
# So, this route will be accessible at POST /api/chat
@chat_bp.route("", methods=["POST"]) # Empty path means it's at the blueprint's prefix
def api_chat_route() -> Any:
    """
    Handles chat messages from the user, sent to `/api/chat`.
    Supports both streaming (default) and non-streaming responses.
    It reads RAG settings, LLM provider/model, system message, and prompt template
    values from the Flask session to configure the LLMCore chat call.
    Staged context items from the client are also resolved and passed to LLMCore.

    Request JSON Body:
    {
        "message": "User's message content",
        "session_id": "Optional: LLMCore session ID. Uses current from Flask session if not provided.",
        "stream": "Optional: boolean, defaults to true. False for a single aggregated response.",
        "active_context_specification": "Optional: Array of staged items from client."
    }

    Returns:
        - If streaming: A Flask `Response` with `text/event-stream` content type.
        - If not streaming: A JSON object with the assistant's response.
        - Error JSON object on failure.
    """
    if not llmcore_instance:
        logger.error("/api/chat called but LLM service (llmcore_instance) is not available.")
        return jsonify({"error": "LLM service not available."}), 503

    data = request.json
    if not data or "message" not in data:
        logger.warning("/api/chat called without 'message' in JSON payload.")
        return jsonify({"error": "No message provided."}), 400

    user_message_content: str = data["message"]
    # Use session_id from request if provided, otherwise fallback to current web session ID
    session_id_from_request: Optional[str] = data.get("session_id", get_current_web_session_id())
    stream_requested: bool = data.get("stream", True) # Default to streaming
    # Get client-side staged items for explicit context
    active_context_spec_from_js: List[Dict[str, Any]] = data.get('active_context_specification', [])

    try:
        # Resolve staged items (this is an async helper, so wrap it)
        explicitly_staged_items: List[Union[LLMCoreMessage, LLMCoreContextItem]] = \
            async_to_sync_in_flask(_resolve_staged_items_for_core)(
                active_context_spec_from_js, session_id_from_request
            )
    except Exception as e_resolve_ctx:
        logger.error(f"Error resolving context items for chat session {session_id_from_request}: {e_resolve_ctx}", exc_info=True)
        return jsonify({"error": f"Failed to process context items: {str(e_resolve_ctx)}"}), 500

    # Log the chat request details, including settings from Flask session
    logger.info(
        f"Chat request for session '{session_id_from_request}'. Message: '{user_message_content[:50]}...'. "
        f"Provider: {flask_session.get('current_provider_name')}, Model: {flask_session.get('current_model_name')}. "
        f"RAG: {flask_session.get('rag_enabled', False)}, Collection: {flask_session.get('rag_collection_name')}, K: {flask_session.get('rag_k_value')}, Filter: {flask_session.get('rag_filter')}. "
        f"SystemMsg: '{str(flask_session.get('system_message', ''))[:50]}...'. "
        f"PromptValues: {flask_session.get('prompt_template_values', {})}. "
        f"Staged items: {len(explicitly_staged_items)}. Stream: {stream_requested}."
    )

    # Prepare parameters for LLMCore.chat call
    llm_core_params: Dict[str, Any] = {
        "message": user_message_content,
        "session_id": session_id_from_request, # Can be None if new session
        "provider_name": flask_session.get('current_provider_name'),
        "model_name": flask_session.get('current_model_name'),
        "system_message": flask_session.get('system_message'),
        "save_session": True, # Always save session for web interface interactions
        "enable_rag": flask_session.get('rag_enabled', False),
        "rag_collection_name": flask_session.get('rag_collection_name'),
        "rag_retrieval_k": flask_session.get('rag_k_value'),
        "rag_metadata_filter": flask_session.get('rag_filter'), # This should be a dict or None
        "prompt_template_values": flask_session.get('prompt_template_values', {}),
        "explicitly_staged_items": explicitly_staged_items,
        "stream": stream_requested # Crucial parameter
    }

    if stream_requested:
        # Use the synchronous generator wrapper for stream_with_context
        # _stream_chat_responses_route_helper is an async generator
        sync_generator = run_async_generator_synchronously(_stream_chat_responses_route_helper, llm_core_params)
        return Response(stream_with_context(sync_generator), content_type="text/event-stream")
    else: # Non-streaming request
        try:
            # Call async LLMCore.chat synchronously using the wrapper from app.py
            response_content_str: str = async_to_sync_in_flask(llmcore_instance.chat)(**llm_core_params) # type: ignore

            # After a non-streaming response, also fetch the message ID and context usage
            last_msg_id = async_to_sync_in_flask(_get_last_assistant_message_id)(session_id_from_request)
            ctx_usage = async_to_sync_in_flask(get_context_usage_info)(session_id_from_request) # From app.py

            logger.info(f"Non-stream chat response for session {session_id_from_request} successful. Message ID: {last_msg_id}")
            return jsonify({
                "role": "assistant", # Or LLMCoreRole.ASSISTANT.value
                "content": response_content_str,
                "message_id": last_msg_id,
                "context_usage": ctx_usage
            })
        except (ProviderError, ContextLengthError, SessionNotFoundError, LLMCoreError) as e:
            logger.error(f"LLMCore chat error (non-stream) for session {session_id_from_request}: {e}", exc_info=True)
            return jsonify({"error": str(e)}), 500
        except Exception as e_unexp:
            logger.error(f"Unexpected error during non-stream chat for session {session_id_from_request}: {e_unexp}", exc_info=True)
            return jsonify({"error": "An unexpected server error occurred during chat."}), 500

logger.info("Chat routes (/api/chat) defined on chat_bp.")
