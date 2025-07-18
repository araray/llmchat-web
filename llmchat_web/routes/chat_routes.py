# llmchat_web/routes/chat_routes.py
"""
Flask routes for chat functionalities in the llmchat-web application.
Handles sending messages and streaming responses via the LLMCore HTTP API.
"""
import logging
from typing import Any, Dict, Optional

from flask import Response, jsonify, request, stream_with_context
from flask import session as flask_session

from . import chat_bp
from ..app import (
    async_to_sync_in_flask,
    run_async_generator_synchronously,
    get_current_web_session_id,
    logger as app_logger
)
from ..services import LLMCoreAPIClient

logger = logging.getLogger("llmchat_web.routes.chat")
if not logger.handlers and app_logger:
    logger.parent = logging.getLogger("llmchat_web.routes")
    if logger.parent and logger.parent.level:
        logger.setLevel(logger.parent.level)
    else:
        logger.setLevel(app_logger.level if app_logger else logging.DEBUG)


@chat_bp.route("", methods=["POST"])
def api_chat_route() -> Any:
    """
    Handles chat messages from the user via the LLMCore HTTP API.

    This route has been refactored to communicate with LLMCore through HTTP
    requests instead of direct library calls, enabling proper service decoupling.

    JSON Payload:
        message (str): The user's message from the main chat input box.
        session_id (Optional[str]): The active session ID.
        stream (bool): Whether to stream the response (default: True).
    """
    data = request.json
    if not data or "message" not in data:
        logger.warning("/api/chat called without 'message' in JSON payload.")
        return jsonify({"error": "No message provided."}), 400

    user_message_content: str = data["message"]
    session_id_from_request: Optional[str] = data.get("session_id", get_current_web_session_id())
    stream_requested: bool = data.get("stream", True)

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

    # --- Rationale Block: API Client Integration ---
    # Pre-state: The route directly called llmcore_instance.chat() with complex parameter
    #            construction including staging, RAG settings, and context management.
    # Limitation: Direct library coupling prevented independent deployment and scaling
    #             of the web interface and core LLM functionality.
    # Decision Path: Replace direct LLMCore calls with HTTP API requests using the new
    #                LLMCoreAPIClient service. For this initial refactor, we focus on
    #                basic chat functionality and will implement advanced features
    #                (staging, RAG, context override) in subsequent phases.
    # Post-state: The route now constructs a payload matching the ChatRequest model
    #             and uses httpx to communicate with the LLMCore API server, enabling
    #             true service separation.

    # Initialize API client
    api_client = LLMCoreAPIClient()

    # Construct payload for LLMCore API
    chat_payload: Dict[str, Any] = {
        "message": user_message_content,
        "session_id": session_id_from_request,
        "provider_name": provider_name,
        "model_name": model_name,
        "system_message": flask_session.get('system_message'),
        "stream": stream_requested,
        "save_session": True,
    }

    # For now, we'll implement basic chat functionality
    # Advanced features like RAG, staging, and context override will be added
    # when the corresponding API endpoints are implemented

    logger.info(
        f"Dispatching to LLMCore API. Message: '{chat_payload.get('message', '')[:50]}...'. "
        f"Provider: {provider_name}, Model: {model_name}. Stream: {stream_requested}."
    )

    if stream_requested:
        try:
            sync_generator = run_async_generator_synchronously(api_client.post_chat, chat_payload)
            return Response(stream_with_context(sync_generator), content_type="text/event-stream")
        except Exception as e:
            logger.error(f"Error in streaming chat request: {e}", exc_info=True)
            return jsonify({"error": f"Chat request failed: {str(e)}"}), 500
    else:
        try:
            response_data: Dict[str, Any] = async_to_sync_in_flask(api_client.post_chat)(chat_payload)
            logger.info(f"Non-stream chat response successful. Session: {session_id_from_request}")
            return jsonify(response_data)
        except Exception as e:
            logger.error(f"Error in non-streaming chat request: {e}", exc_info=True)
            return jsonify({"error": f"Chat request failed: {str(e)}"}), 500


logger.info("Chat routes (/api/chat) defined on chat_bp.")
