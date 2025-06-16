# llmchat_web/routes/chat_routes.py
"""
Flask routes for chat functionalities in the llmchat-web application.
Handles sending messages, streaming responses, and related chat operations.
Now includes emitting RAG results in the SSE stream and handling UI-managed
context overrides.
"""
import asyncio
import json
import logging
import uuid
from typing import Any, AsyncGenerator, Dict, Optional, List, Union
from pathlib import Path
import aiofiles # Added for fallback file reading
from werkzeug.utils import secure_filename # Though not used here, good practice if file names are manipulated

from flask import Response, jsonify, request, stream_with_context
from flask import session as flask_session

from . import chat_bp
from ..app import (
    llmcore_instance,
    async_to_sync_in_flask,
    run_async_generator_synchronously,
    get_context_usage_info,
    get_current_web_session_id,
    logger as app_logger
)
from llmcore import (
    ContextLengthError, LLMCoreError, ProviderError,
    SessionNotFoundError,
    Message as LLMCoreMessage, Role as LLMCoreRole,
    ContextItem as LLMCoreContextItem, ContextItemType as LLMCoreContextItemType
)

logger = logging.getLogger("llmchat_web.routes.chat")
if not logger.handlers and app_logger:
    logger.parent = logging.getLogger("llmchat_web.routes")
    if logger.parent and logger.parent.level:
        logger.setLevel(logger.parent.level)
    else:
        logger.setLevel(app_logger.level if app_logger else logging.DEBUG)

async def _get_last_assistant_message_id(session_id: Optional[str]) -> Optional[str]:
    """Helper to get the ID of the last assistant message in a session."""
    if not llmcore_instance or not session_id:
        logger.warning(f"_get_last_assistant_message_id called with no llmcore_instance or session_id ({session_id})")
        return None
    try:
        session_obj = await llmcore_instance.get_session(session_id)
        if session_obj and session_obj.messages:
            for msg in reversed(session_obj.messages):
                if msg.role == LLMCoreRole.ASSISTANT: return msg.id
        logger.debug(f"No assistant message found in session {session_id} to get ID from.")
    except SessionNotFoundError: logger.warning(f"Session {session_id} not found while trying to get last assistant message ID.")
    except LLMCoreError as e: logger.error(f"LLMCoreError getting last assistant message ID for session {session_id}: {e}")
    except Exception as e_unexp: logger.error(f"Unexpected error in _get_last_assistant_message_id for session {session_id}: {e_unexp}", exc_info=True)
    return None

async def _resolve_staged_items_for_core(
    staged_items_from_js: List[Dict[str, Any]],
    session_id_for_staging: Optional[str]
) -> List[Union[LLMCoreMessage, LLMCoreContextItem]]:
    """
    Resolves items from the client's 'active_context_specification' into
    LLMCoreMessage or LLMCoreContextItem objects suitable for LLMCore.

    This function now robustly handles 'file_content' items by reading the
    file from the specified server-side path, and includes a fallback to re-read
    a workspace file's content if it appears to be empty.

    Args:
        staged_items_from_js: The list of item dictionaries from the client.
        session_id_for_staging: The ID of the session to resolve against.

    Returns:
        A list of resolved LLMCoreMessage or LLMCoreContextItem objects.
    """
    if not llmcore_instance: logger.error("_resolve_staged_items_for_core called but llmcore_instance is None."); return []
    explicitly_staged_items: List[Union[LLMCoreMessage, LLMCoreContextItem]] = []
    if not staged_items_from_js: return explicitly_staged_items
    logger.debug(f"Resolving {len(staged_items_from_js)} staged items from JS for session {session_id_for_staging}.")
    for js_item in staged_items_from_js:
        item_type_str = js_item.get('type'); item_content = js_item.get('content'); item_path = js_item.get('path')
        item_id_ref = js_item.get('id_ref'); item_spec_id = js_item.get('spec_item_id', f"staged_{uuid.uuid4().hex[:8]}")
        no_truncate = js_item.get('no_truncate', False); resolved_item: Optional[Union[LLMCoreMessage, LLMCoreContextItem]] = None
        try:
            if item_type_str == "message_history" and item_id_ref and session_id_for_staging:
                sess_obj = await llmcore_instance.get_session(session_id_for_staging)
                if sess_obj: resolved_item = next((m for m in sess_obj.messages if m.id == item_id_ref), None)
                if resolved_item: logger.debug(f"Resolved staged message_history item: {item_id_ref}")
            elif item_type_str == "workspace_item" and item_id_ref and session_id_for_staging:
                resolved_item = await llmcore_instance.get_context_item(session_id_for_staging, item_id_ref)

                # --- Rationale Block: fix(web): Ensure staged workspace file content is always loaded ---
                # Pre-state: The function trusted that a retrieved workspace item of type USER_FILE
                #            had its full content correctly loaded in the session object.
                # Limitation: If there was a state management issue, the persisted content could be
                #             missing or just whitespace. The previous check `if not resolved_item.content`
                #             was insufficient for these cases.
                # Decision Path: To make this more robust, the check is changed to `if resolved_item.content is None
                #                or not resolved_item.content.strip()`. This explicitly handles `None` and also
                #                trims the content to check if it's effectively empty (only whitespace).
                #                If these conditions are met, the fallback to re-read the file from its
                #                `source_id` path is triggered.
                # Post-state: Staging a file from the workspace is more reliable. If the session's
                #             cached content for the file item is missing or blank, the system will
                #             recover by reading the file from its source path, ensuring the context is
                #             correctly included.
                if resolved_item and resolved_item.type == LLMCoreContextItemType.USER_FILE and (resolved_item.content is None or not resolved_item.content.strip()):
                    logger.warning(f"Workspace item '{resolved_item.id}' is a USER_FILE but has empty/whitespace content. Attempting to re-read from source_id.")
                    if resolved_item.source_id:
                        try:
                            file_path_obj = Path(resolved_item.source_id).expanduser().resolve()
                            # Use async file IO for this async function
                            async with aiofiles.open(file_path_obj, "r", encoding="utf-8", errors="ignore") as f:
                                re_read_content = await f.read()
                            resolved_item.content = re_read_content # Update the content in-place
                            logger.info(f"Successfully re-read content (len: {len(re_read_content)}) for staged file item '{resolved_item.id}' from path '{resolved_item.source_id}'.")
                        except FileNotFoundError:
                            logger.error(f"Could not re-read file for item '{resolved_item.id}': path '{resolved_item.source_id}' not found.")
                        except Exception as e_reread:
                            logger.error(f"Error re-reading file for item '{resolved_item.id}' from path '{resolved_item.source_id}': {e_reread}")
                # --- End Rationale Block & Patch ---

                if resolved_item: logger.debug(f"Resolved staged workspace_item: {item_id_ref}")

            elif item_type_str == "file_content" and item_path:
                file_path_obj = Path(item_path).expanduser()
                if file_path_obj.is_file():
                    file_content_from_path = file_path_obj.read_text(encoding='utf-8', errors='ignore')
                    resolved_item = LLMCoreContextItem(id=item_spec_id, type=LLMCoreContextItemType.USER_FILE, content=file_content_from_path, source_id=item_path, metadata={"filename": file_path_obj.name, "llmchat_web_staged": True, "ignore_char_limit": no_truncate})
                    logger.debug(f"Read and created staged file_content item for path: {item_path} (Content length: {len(file_content_from_path)})")
                else:
                    logger.warning(f"Staged file_content path does not exist or is not a file: {item_path}")
            elif item_type_str == "text_content" and item_content is not None:
                resolved_item = LLMCoreContextItem(id=item_spec_id, type=LLMCoreContextItemType.USER_TEXT, content=item_content, source_id=item_spec_id, metadata={"llmchat_web_staged": True, "ignore_char_limit": no_truncate})
                logger.debug(f"Created staged text_content item with ID: {item_spec_id}")
            if resolved_item: explicitly_staged_items.append(resolved_item)
            else: logger.warning(f"Could not resolve staged item from JS: Type='{item_type_str}', Ref='{item_id_ref}', Path='{item_path}'. Item details: {js_item}")
        except Exception as e_resolve: logger.error(f"Error resolving staged item {js_item}: {e_resolve}", exc_info=True)
    logger.info(f"Successfully resolved {len(explicitly_staged_items)} items for LLMCore explicit staging.")
    return explicitly_staged_items

async def _stream_chat_responses_route_helper(llm_core_chat_params: Dict[str, Any]) -> AsyncGenerator[str, None]:
    """
    Async generator for streaming chat responses.
    This encapsulates the LLMCore call and SSE formatting, including now
    emitting a `rag_results` event after the chat stream completes if RAG was used.
    """
    if not llmcore_instance:
        logger.error("LLMCore instance not available for streaming chat.")
        yield f"data: {json.dumps({'type': 'error', 'error': 'LLM service not available.'})}\n\n"; yield f"data: {json.dumps({'type': 'end'})}\n\n"; return

    session_id_for_meta = llm_core_chat_params.get("session_id")
    logger.debug(f"Starting chat stream for session {session_id_for_meta} with params: {str(llm_core_chat_params.get('message'))[:50]}...")
    try:
        response_generator = await llmcore_instance.chat(**llm_core_chat_params)
        async for chunk_content in response_generator:
            yield f"data: {json.dumps({'type': 'chunk', 'content': chunk_content})}\n\n"
            await asyncio.sleep(0.01)

        logger.debug(f"Chat stream completed for session {session_id_for_meta}. Fetching post-stream metadata.")

        if session_id_for_meta:
            # New: Fetch RAG results from LLMCore's transient cache
            context_details = await llmcore_instance.get_last_interaction_context_info(session_id_for_meta)
            if context_details and context_details.rag_documents_used:
                rag_docs_payload = [doc.model_dump(mode="json") for doc in context_details.rag_documents_used]
                yield f"data: {json.dumps({'type': 'rag_results', 'documents': rag_docs_payload})}\n\n"
                logger.info(f"Yielded {len(rag_docs_payload)} RAG results for session {session_id_for_meta}.")

            # Existing logic for other metadata
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


@chat_bp.route("", methods=["POST"])
def api_chat_route() -> Any:
    """
    Handles chat messages from the user, supporting both LLMCore-managed context
    and a direct UI-managed context override.

    This route checks for `raw_prompt_workbench_content` in the payload. If present,
    it uses this content directly to call LLMCore with the `context_override`
    parameter. Otherwise, it follows the standard procedure of using LLMCore's
    internal context management (history, RAG, staged items).

    JSON Payload:
        message (str): The user's message from the main chat input box.
        session_id (Optional[str]): The active session ID.
        stream (bool): Whether to stream the response (default: True).
        raw_prompt_workbench_content (Optional[str]): If provided, its content is
            used to override LLMCore's context assembly.
        active_context_specification (Optional[List[Dict]]): Used in LLMCore-managed mode.
        message_inclusion_map (Optional[Dict[str, bool]]): Used in LLMCore-managed mode.
    """
    if not llmcore_instance: logger.error("/api/chat called but LLM service (llmcore_instance) is not available."); return jsonify({"error": "LLM service not available."}), 503
    data = request.json
    if not data or "message" not in data: logger.warning("/api/chat called without 'message' in JSON payload."); return jsonify({"error": "No message provided."}), 400

    user_message_content: str = data["message"]
    session_id_from_request: Optional[str] = data.get("session_id", get_current_web_session_id())
    stream_requested: bool = data.get("stream", True)
    raw_prompt_workbench_content: Optional[str] = data.get("raw_prompt_workbench_content")

    if logger.isEnabledFor(logging.DEBUG):
        session_details_for_chat_route = {
            "current_llm_session_id_in_flask": flask_session.get('current_llm_session_id'),
            "current_provider_name_in_flask": flask_session.get('current_provider_name'),
            "current_model_name_in_flask": flask_session.get('current_model_name'),
            "flask_session_full_content_keys": list(flask_session.keys())
        }
        logger.debug(f"FLASK_SESSION_STATE_SUMMARY (Inside /api/chat for session_id_from_request: {session_id_from_request}): {session_details_for_chat_route}")

    provider_name = flask_session.get('current_provider_name')
    model_name = flask_session.get('current_model_name')

    if provider_name is None and llmcore_instance and llmcore_instance.config:
        default_provider = llmcore_instance.config.get("llmcore.default_provider")
        if default_provider:
            logger.warning(f"Chat route: 'current_provider_name' was None in Flask session for request to '{request.path}'. Initializing from LLMCore default: {default_provider}.")
            provider_name = default_provider; flask_session['current_provider_name'] = provider_name
            default_model = llmcore_instance.config.get(f"providers.{provider_name}.default_model")
            if default_model:
                logger.info(f"Chat route: Setting model to provider '{provider_name}' default: {default_model} as current_model_name was also likely None or inconsistent."); model_name = default_model; flask_session['current_model_name'] = model_name
            elif model_name is None : logger.warning(f"Chat route: 'current_model_name' is None for provider '{provider_name}', and no default model found in config.")
        else: logger.error("Chat route: 'current_provider_name' is None and no LLMCore default provider is configured.")
    elif model_name is None and provider_name and llmcore_instance and llmcore_instance.config:
        default_model = llmcore_instance.config.get(f"providers.{provider_name}.default_model")
        if default_model:
            logger.warning(f"Chat route: 'current_model_name' was None in Flask session for provider '{provider_name}' for request to '{request.path}'. Initializing from provider's default model: {default_model}.")
            model_name = default_model; flask_session['current_model_name'] = model_name
        else: logger.warning(f"Chat route: 'current_model_name' is None for provider '{provider_name}', and no default model found in config.")

    flask_session.modified = True

    llm_core_params: Dict[str, Any]

    if raw_prompt_workbench_content is not None:
        # --- Rationale Block: FEAT-03 - Direct Context Override ---
        # Pre-state: The route always constructed chat parameters for LLMCore's default
        #            context management (history, RAG, staging).
        # Limitation: This did not allow for a "UI Managed" mode where the user
        #             crafts the entire prompt payload directly.
        # Decision Path: Following spec FEAT-03, when `raw_prompt_workbench_content` is received,
        #                we bypass the standard context-building parameters (RAG, staging, etc.).
        #                Instead, we construct a `context_override` list containing a single
        #                user message with the raw content from the prompt workbench. This payload
        #                is then passed to `llmcore.chat`, which will use it directly, bypassing
        #                its own `ContextManager`. The original `message` from the chat input
        #                is still passed to `llmcore.chat` to ensure the user's turn is correctly
        #                recorded in the session history.
        # Post-state: The route now supports a UI-managed context mode, enabling expert-level
        #             prompt engineering from the web interface.
        logger.info(f"Chat request for session '{session_id_from_request}' in UI_MANAGED mode.")

        context_override_payload = [
            LLMCoreMessage(
                role=LLMCoreRole.USER,
                content=raw_prompt_workbench_content,
                session_id=session_id_from_request if session_id_from_request else "stateless_override"
            )
        ]

        llm_core_params = {
            "message": user_message_content, # Still pass for history saving
            "session_id": session_id_from_request,
            "provider_name": provider_name,
            "model_name": model_name,
            "stream": stream_requested,
            "save_session": True, # Always save UI Managed turn to history
            "context_override": context_override_payload,
        }
    else:
        # LLMCORE_MANAGED mode (existing logic)
        logger.info(f"Chat request for session '{session_id_from_request}' in LLMCORE_MANAGED mode.")
        message_inclusion_map: Optional[Dict[str, bool]] = data.get('message_inclusion_map', None)
        active_context_spec_from_js: List[Dict[str, Any]] = data.get('active_context_specification', [])
        try:
            explicitly_staged_items = async_to_sync_in_flask(_resolve_staged_items_for_core)(active_context_spec_from_js, session_id_from_request)
        except Exception as e_resolve_ctx:
            logger.error(f"Error resolving context items for chat session {session_id_from_request}: {e_resolve_ctx}", exc_info=True)
            return jsonify({"error": f"Failed to process context items: {str(e_resolve_ctx)}"}), 500

        llm_core_params = {
            "message": user_message_content, "session_id": session_id_from_request,
            "provider_name": provider_name, "model_name": model_name,
            "system_message": flask_session.get('system_message'), "save_session": True,
            "enable_rag": flask_session.get('rag_enabled', False),
            "rag_collection_name": flask_session.get('rag_collection_name'),
            "rag_retrieval_k": flask_session.get('rag_k_value'),
            "rag_metadata_filter": flask_session.get('rag_filter'),
            "prompt_template_values": flask_session.get('prompt_template_values', {}),
            "explicitly_staged_items": explicitly_staged_items,
            "stream": stream_requested,
            "message_inclusion_map": message_inclusion_map,
        }

    logger.info(
        f"Dispatching to LLMCore.chat. Message: '{llm_core_params.get('message', '')[:50]}...'. "
        f"Provider: {provider_name}, Model: {model_name}. "
        f"UI_Managed: {raw_prompt_workbench_content is not None}. Stream: {stream_requested}."
    )

    if stream_requested:
        llm_core_params["stream"] = True
        sync_generator = run_async_generator_synchronously(_stream_chat_responses_route_helper, llm_core_params)
        return Response(stream_with_context(sync_generator), content_type="text/event-stream")
    else:
        llm_core_params["stream"] = False
        try:
            response_content_str: str = async_to_sync_in_flask(llmcore_instance.chat)(**llm_core_params)
            last_msg_id = async_to_sync_in_flask(_get_last_assistant_message_id)(session_id_from_request)
            ctx_usage = async_to_sync_in_flask(get_context_usage_info)(session_id_from_request)
            logger.info(f"Non-stream chat response for session {session_id_from_request} successful. Message ID: {last_msg_id}")
            return jsonify({"role": "assistant", "content": response_content_str, "message_id": last_msg_id, "context_usage": ctx_usage})
        except (ProviderError, ContextLengthError, SessionNotFoundError, LLMCoreError) as e: logger.error(f"LLMCore chat error (non-stream) for session {session_id_from_request}: {e}", exc_info=True); return jsonify({"error": str(e)}), 500
        except Exception as e_unexp: logger.error(f"Unexpected error during non-stream chat for session {session_id_from_request}: {e_unexp}", exc_info=True); return jsonify({"error": "An unexpected server error occurred during chat."}), 500

logger.info("Chat routes (/api/chat) defined on chat_bp.")
