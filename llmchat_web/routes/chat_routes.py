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
    run_async_generator_synchronously, # <-- MOVED TO APP.PY, IMPORTED HERE
    get_context_usage_info,
    get_current_web_session_id,
    logger as app_logger # Main app logger
)

# Import specific LLMCore exceptions and models relevant to chat
from llmcore import (
    ContextLengthError, LLMCoreError, ProviderError,
    SessionNotFoundError,
    Message as LLMCoreMessage, Role as LLMCoreRole,
    ContextItem as LLMCoreContextItem, ContextItemType as LLMCoreContextItemType
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
    # ... (existing code for _get_last_assistant_message_id) ...
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
    # ... (existing code for _resolve_staged_items_for_core) ...
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
                resolved_item = LLMCoreContextItem(
                    id=item_spec_id,
                    type=LLMCoreContextItemType.USER_FILE,
                    content=item_content,
                    source_id=item_path,
                    metadata={
                        "filename": Path(item_path).name,
                        "llmchat_web_staged": True,
                        "ignore_char_limit": no_truncate
                    }
                )
                logger.debug(f"Created staged file_content item for path: {item_path}")
            elif item_type_str == "text_content" and item_content is not None:
                resolved_item = LLMCoreContextItem(
                    id=item_spec_id,
                    type=LLMCoreContextItemType.USER_TEXT,
                    content=item_content,
                    source_id=item_spec_id,
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
    # ... (existing code for _stream_chat_responses_route_helper) ...
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
        response_generator = await llmcore_instance.chat(**llm_core_chat_params) # type: ignore
        async for chunk_content in response_generator:
            yield f"data: {json.dumps({'type': 'chunk', 'content': chunk_content})}\n\n"
            await asyncio.sleep(0.01)

        logger.debug(f"Chat stream completed for session {session_id_for_meta}. Fetching metadata.")
        if session_id_for_meta:
            last_assistant_message_id = await _get_last_assistant_message_id(session_id_for_meta)
            context_usage_data = await get_context_usage_info(session_id_for_meta)

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

# run_async_generator_synchronously was removed from here and is now imported from ..app

# --- Chat Route ---
@chat_bp.route("", methods=["POST"])
def api_chat_route() -> Any:
    # ... (existing code for api_chat_route, ensuring it uses the imported run_async_generator_synchronously) ...
    if not llmcore_instance:
        logger.error("/api/chat called but LLM service (llmcore_instance) is not available.")
        return jsonify({"error": "LLM service not available."}), 503

    data = request.json
    if not data or "message" not in data:
        logger.warning("/api/chat called without 'message' in JSON payload.")
        return jsonify({"error": "No message provided."}), 400

    user_message_content: str = data["message"]
    session_id_from_request: Optional[str] = data.get("session_id", get_current_web_session_id())
    stream_requested: bool = data.get("stream", True)
    active_context_spec_from_js: List[Dict[str, Any]] = data.get('active_context_specification', [])

    try:
        explicitly_staged_items: List[Union[LLMCoreMessage, LLMCoreContextItem]] = \
            async_to_sync_in_flask(_resolve_staged_items_for_core)(
                active_context_spec_from_js, session_id_from_request
            )
    except Exception as e_resolve_ctx:
        logger.error(f"Error resolving context items for chat session {session_id_from_request}: {e_resolve_ctx}", exc_info=True)
        return jsonify({"error": f"Failed to process context items: {str(e_resolve_ctx)}"}), 500

    logger.info(
        f"Chat request for session '{session_id_from_request}'. Message: '{user_message_content[:50]}...'. "
        f"Provider: {flask_session.get('current_provider_name')}, Model: {flask_session.get('current_model_name')}. "
        f"RAG: {flask_session.get('rag_enabled', False)}, Collection: {flask_session.get('rag_collection_name')}, K: {flask_session.get('rag_k_value')}, Filter: {flask_session.get('rag_filter')}. "
        f"SystemMsg: '{str(flask_session.get('system_message', ''))[:50]}...'. "
        f"PromptValues: {flask_session.get('prompt_template_values', {})}. "
        f"Staged items: {len(explicitly_staged_items)}. Stream: {stream_requested}."
    )

    llm_core_params: Dict[str, Any] = {
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
        "explicitly_staged_items": explicitly_staged_items,
        "stream": stream_requested
    }

    if stream_requested:
        sync_generator = run_async_generator_synchronously(_stream_chat_responses_route_helper, llm_core_params)
        return Response(stream_with_context(sync_generator), content_type="text/event-stream")
    else:
        try:
            response_content_str: str = async_to_sync_in_flask(llmcore_instance.chat)(**llm_core_params) # type: ignore
            last_msg_id = async_to_sync_in_flask(_get_last_assistant_message_id)(session_id_from_request)
            ctx_usage = async_to_sync_in_flask(get_context_usage_info)(session_id_from_request)

            logger.info(f"Non-stream chat response for session {session_id_from_request} successful. Message ID: {last_msg_id}")
            return jsonify({
                "role": "assistant",
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
