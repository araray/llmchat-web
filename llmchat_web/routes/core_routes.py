# llmchat_web/routes/core_routes.py
"""
Core Flask routes for the llmchat-web application.
Handles serving the main page, API status, and basic commands.
"""
import logging
import uuid
from datetime import datetime
from typing import Any, Dict # Added Dict for type hinting

from flask import jsonify, render_template, request
from flask import session as flask_session # Alias to avoid confusion

# Import the specific blueprint defined in the routes package's __init__.py
from . import core_bp

# Import shared components from the main app module (llmchat_web.app)
from ..app import (
    llmcore_instance,
    llmcore_init_error, # The global init error from app.py
    async_to_sync_in_flask,
    get_current_web_session_id,
    set_current_web_session_id,
    logger as app_logger, # Main app logger, can be used as parent
    APP_VERSION
)

# Configure a local logger for this specific routes module
# This logger will be a child of "llmchat_web.routes"
logger = logging.getLogger("llmchat_web.routes.core")
# Ensure it uses the parent's level if not specifically set otherwise
if not logger.handlers and app_logger: # Check if handlers are already added
    logger.parent = logging.getLogger("llmchat_web.routes") # Set parent to the routes package logger
    if logger.parent and logger.parent.level:
        logger.setLevel(logger.parent.level)
    else: # Fallback if parent logger isn't fully set up (should be by app.py)
        logger.setLevel(app_logger.level if app_logger else logging.DEBUG)


@core_bp.route("/")
def index() -> str:
    """
    Serves the main HTML page for the llmchat-web interface.
    Initializes Flask session variables if not already set.
    These variables manage UI state like RAG settings, LLM provider/model, etc.
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


@core_bp.route("/api/status", methods=["GET"])
def api_status() -> Any:
    """
    API endpoint to check the status of the backend and LLMCore.
    Returns current provider/model, session ID, RAG settings, system message,
    prompt template values from Flask session, and application version.
    """
    llmcore_status_val = "operational"
    llmcore_error_detail_val = None
    llmcore_default_provider_val = None
    llmcore_default_model_val = None

    if llmcore_init_error: # Use the error status from app.py
        llmcore_status_val = "error"
        llmcore_error_detail_val = llmcore_init_error
    elif llmcore_instance is None:
        llmcore_status_val = "initializing"
        llmcore_error_detail_val = "LLMCore instance is None (still initializing or failed silently)."
    elif llmcore_instance and llmcore_instance.config:
        llmcore_default_provider_val = llmcore_instance.config.get("llmcore.default_provider")
        if llmcore_default_provider_val:
            provider_conf_key = f"providers.{llmcore_default_provider_val}"
            llmcore_default_model_val = llmcore_instance.config.get(f"{provider_conf_key}.default_model")
    else: # llmcore_instance exists but config is somehow unavailable (should not happen if init was ok)
        llmcore_status_val = "error"
        llmcore_error_detail_val = "LLMCore instance exists but its config is unavailable."

    current_provider_val = flask_session.get('current_provider_name', llmcore_default_provider_val)
    current_model_val = flask_session.get('current_model_name', llmcore_default_model_val)
    current_session_id_val = get_current_web_session_id()

    # Ensure model is consistent with provider if provider is set
    if current_model_val is None and current_provider_val and llmcore_instance and llmcore_instance.config:
        current_model_val = llmcore_instance.config.get(f"providers.{current_provider_val}.default_model")

    rag_enabled_val = flask_session.get('rag_enabled', False)
    rag_collection_name_val = flask_session.get('rag_collection_name')
    rag_k_val = flask_session.get('rag_k_value')
    rag_filter_val = flask_session.get('rag_filter') # Expected to be dict or None
    system_message_val = flask_session.get('system_message', "")
    prompt_template_values_val = flask_session.get('prompt_template_values', {})

    status_payload: Dict[str, Any] = {
        "service_status": "operational", # llmchat-web service itself
        "llmcore_status": llmcore_status_val,
        "llmcore_error": llmcore_error_detail_val,
        "current_provider": current_provider_val,
        "current_model": current_model_val,
        "current_session_id": current_session_id_val,
        "app_version": APP_VERSION,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "rag_enabled": rag_enabled_val,
        "rag_collection_name": rag_collection_name_val,
        "rag_k_value": rag_k_val,
        "rag_filter": rag_filter_val,
        "system_message": system_message_val,
        "prompt_template_values": prompt_template_values_val,
    }
    logger.debug(f"API Status Check. LLMCore: {llmcore_status_val}. Current Session: {current_session_id_val}")
    return jsonify(status_payload)


@core_bp.route("/api/command", methods=["POST"])
@async_to_sync_in_flask # Keep async wrapper if future commands might be async
async def api_command_route() -> Any:
    """
    Handles commands submitted from the UI's command tab.
    This is a generic endpoint for potential future command-line like interactions.
    Currently, it acknowledges the command.
    """
    data = request.json
    if not data or "command" not in data:
        logger.warning("Command API called without 'command' field in JSON payload.")
        return jsonify({"error": "No command provided."}), 400

    command_text = data["command"]
    logger.info(f"Received command via API: '{command_text}'")

    # Placeholder: Echo command or simple acknowledgement
    # Future: Parse command_text and execute corresponding actions.
    # This might involve calling methods on llmcore_instance or other services.
    # Example:
    # if command_text.startswith("/llm_action"):
    #     param = command_text.split(" ", 1)[1] if len(command_text.split(" ", 1)) > 1 else None
    #     if llmcore_instance:
    #         result = await llmcore_instance.some_action(param) # Hypothetical async action
    #         return jsonify({"output": f"Action result: {result}"})
    #     else:
    #         return jsonify({"error": "LLM service not available for command."}), 503

    response_output = f"Command received: '{command_text}'. (Execution not yet implemented.)"
    return jsonify({
        "command_received": command_text,
        "output": response_output,
        "status": "acknowledged_placeholder"
    })

logger.info("Core routes (index, /api/status, /api/command) defined on core_bp.")
