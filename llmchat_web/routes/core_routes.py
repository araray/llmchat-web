# llmchat_web/routes/core_routes.py
"""
Core Flask routes for the llmchat-web application.
Handles serving the main page, API status, basic commands, log retrieval,
and utility functions like token estimation.
"""
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, Optional # Added Optional
from pathlib import Path
import os

from flask import jsonify, render_template, request
from flask import session as flask_session # Alias to avoid confusion

# Import the specific blueprint defined in the routes package's __init__.py
from . import core_bp

# Import shared components from the main app module (llmchat_web.app)
from ..app import (
    llmcore_instance,
    llmcore_init_error, # The global init error from app.py
    async_to_sync_in_flask,
    get_context_usage_info, # Import the helper function
    get_current_web_session_id,
    set_current_web_session_id,
    logger as app_logger, # Main app logger, can be used as parent
    APP_VERSION
)

# Added LLMCoreError and ProviderError for new endpoint
from llmcore import LLMCoreError, ProviderError

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
        # Try to get default from llmcore_cfg if available, else False
        default_rag_enabled = False
        if llmcore_instance and llmcore_instance.config:
            default_rag_enabled = llmcore_instance.config.get("context_management.rag_enabled_default", False)
        flask_session['rag_enabled'] = default_rag_enabled
        logger.debug(f"Flask session 'rag_enabled' initialized to: {flask_session['rag_enabled']}.")

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
    default_provider_from_core = None
    default_model_from_core = None
    if llmcore_instance and llmcore_instance.config:
        default_provider_from_core = llmcore_instance.config.get("llmcore.default_provider")
        if default_provider_from_core:
            provider_conf_key = f"providers.{default_provider_from_core}"
            default_model_from_core = llmcore_instance.config.get(f"{provider_conf_key}.default_model")

    if 'current_provider_name' not in flask_session:
        flask_session['current_provider_name'] = default_provider_from_core
        logger.debug(f"Flask session 'current_provider_name' initialized to LLMCore default: {flask_session.get('current_provider_name')}")

    if 'current_model_name' not in flask_session:
        flask_session['current_model_name'] = default_model_from_core
        logger.debug(f"Flask session 'current_model_name' initialized: {flask_session.get('current_model_name')}")

    if 'system_message' not in flask_session:
        default_system_message = ""
        if llmcore_instance and llmcore_instance.config:
            default_system_message = llmcore_instance.config.get("llmcore.default_system_message", "")
        flask_session['system_message'] = default_system_message
        logger.debug(f"Flask session 'system_message' initialized to: '{str(default_system_message)[:50]}...'")

    if 'prompt_template_values' not in flask_session:
        flask_session['prompt_template_values'] = {}
        logger.debug("Flask session 'prompt_template_values' initialized to empty dict.")

    flask_session.modified = True # Ensure any changes made are saved
    return render_template("index.html", app_version=APP_VERSION)


@core_bp.route("/api/status", methods=["GET"])
@async_to_sync_in_flask
async def api_status() -> Any:
    """
    API endpoint to check the status of the backend and LLMCore.
    Returns current provider/model, session ID, RAG settings, system message,
    prompt template values, context usage info, and application version.
    """
    llmcore_status_val = "operational"
    llmcore_error_detail_val = None
    llmcore_default_provider_val = None
    llmcore_default_model_val = None

    if llmcore_init_error:
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
    else:
        llmcore_status_val = "error"
        llmcore_error_detail_val = "LLMCore instance exists but its config is unavailable."

    current_provider_val = flask_session.get('current_provider_name', llmcore_default_provider_val)
    current_model_val = flask_session.get('current_model_name', llmcore_default_model_val)

    if current_provider_val and current_model_val is None:
        if llmcore_instance and llmcore_instance.config:
            provider_specific_default_model = llmcore_instance.config.get(f"providers.{current_provider_val}.default_model")
            if provider_specific_default_model:
                current_model_val = provider_specific_default_model
                logger.debug(f"API Status: Model was None for provider '{current_provider_val}', set to provider's default: '{current_model_val}'.")

    current_session_id_val = get_current_web_session_id()
    rag_enabled_val = flask_session.get('rag_enabled', False)
    rag_collection_name_val = flask_session.get('rag_collection_name')
    rag_k_val = flask_session.get('rag_k_value')
    rag_filter_val = flask_session.get('rag_filter')
    system_message_val = flask_session.get('system_message', "")
    prompt_template_values_val = flask_session.get('prompt_template_values', {})

    # Fetch context usage info for the current session
    context_usage_val = await get_context_usage_info(current_session_id_val)

    status_payload: Dict[str, Any] = {
        "service_status": "operational",
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
        "context_usage": context_usage_val, # Add the context usage to the payload
    }
    logger.debug(f"API Status Check. LLMCore: {llmcore_status_val}. Session: {current_session_id_val}. ContextUsage: {context_usage_val}")
    return jsonify(status_payload)


@core_bp.route("/api/command", methods=["POST"])
@async_to_sync_in_flask
async def api_command_route() -> Any:
    """
    Handles commands submitted from the UI's command tab.
    This is a generic endpoint for potential future command-line like interactions.
    Currently, it acknowledges the command and can be expanded to execute specific actions.
    """
    data = request.json
    if not data or "command" not in data:
        logger.warning("Command API called without 'command' field in JSON payload.")
        return jsonify({"error": "No command provided."}), 400

    command_text: str = data["command"]
    logger.info(f"Received command via API: '{command_text}'")

    response_output = f"Command received: '{command_text}'. (Execution placeholder)"
    return jsonify({
        "command_received": command_text,
        "output": response_output,
        "status": "acknowledged_placeholder"
    })

@core_bp.route("/api/logs", methods=["GET"])
def api_logs_route() -> Any:
    """
    API endpoint to fetch recent application logs.
    Attempts to read the `llmchat_web_daemon.stderr.log` file from the
    standard llmchat configuration directory.
    The number of lines returned can be specified with the `lines` query parameter.
    """
    log_lines_to_fetch = request.args.get("lines", 200, type=int)
    max_lines_cap = 2000 # Safety cap
    if log_lines_to_fetch <= 0:
        log_lines_to_fetch = 200
    elif log_lines_to_fetch > max_lines_cap:
        log_lines_to_fetch = max_lines_cap
        logger.info(f"Requested log lines ({request.args.get('lines')}) exceeded cap, using {max_lines_cap}.")

    log_file_name = "llmchat_web_daemon.stderr.log"
    log_file_path_str = ""

    try:
        from appdirs import user_config_dir
        app_config_dir = Path(user_config_dir("llmchat", appauthor=False))
        log_file_path = app_config_dir / "logs" / log_file_name
        log_file_path_str = str(log_file_path)
        logger.debug(f"Constructed log file path using appdirs: {log_file_path}")
    except ImportError:
        logger.warning("'appdirs' library not found. Falling back to manual path construction for logs.")
        log_file_path_str = "~/.config/llmchat/logs/" + log_file_name
        log_file_path = Path(os.path.expanduser(log_file_path_str))
    except Exception as e_appdirs:
        logger.error(f"Error using appdirs to determine log path: {e_appdirs}. Falling back.")
        log_file_path_str = "~/.config/llmchat/logs/" + log_file_name
        log_file_path = Path(os.path.expanduser(log_file_path_str))

    logger.info(f"Attempting to read last {log_lines_to_fetch} lines from log file: {log_file_path}")

    if not log_file_path.exists() or not log_file_path.is_file():
        logger.warning(f"Log file not found or is not a file: {log_file_path}")
        error_msg = f"Log file '{log_file_name}' not found at expected location: {log_file_path.parent}"
        return jsonify({"error": error_msg, "logs": f"[INFO] {error_msg}\n[INFO] Path checked: {log_file_path}"}), 404

    try:
        with open(log_file_path, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
            log_content_lines = lines[-log_lines_to_fetch:]
            log_content = "".join(log_content_lines)

        logger.info(f"Successfully read last {len(log_content_lines)} lines from {log_file_path}")
        return jsonify({"logs": log_content})
    except PermissionError:
        logger.error(f"Permission denied when trying to read log file {log_file_path}.", exc_info=True)
        return jsonify({"error": f"Permission denied reading log file: {log_file_name}", "logs": ""}), 500
    except Exception as e:
        logger.error(f"Error reading log file {log_file_path}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to read log file: {str(e)}", "logs": ""}), 500


@core_bp.route("/api/utils/estimate_tokens", methods=["POST"])
@async_to_sync_in_flask
async def estimate_tokens_route() -> Any:
    """
    API endpoint to estimate the token count for a given string using
    a specified provider and model. This enables UI features like live
    token counting for text areas.

    Expects JSON payload: {
        "text": "The string to tokenize.",
        "provider_name": "The LLM provider to use for tokenization.",
        "model_name": "Optional: The specific model for context."
    }
    """
    if not llmcore_instance:
        logger.error("Attempted to estimate tokens, but LLM service is not available.")
        return jsonify({"error": "LLM service not available."}), 503

    data = request.json
    if not data or "text" not in data or "provider_name" not in data:
        logger.warning("Token estimation API called without 'text' or 'provider_name' fields.")
        return jsonify({"error": "Missing required fields: 'text' and 'provider_name'."}), 400

    text_to_tokenize = data["text"]
    provider_name = data["provider_name"]
    model_name = data.get("model_name") # Optional

    try:
        token_count = await llmcore_instance.estimate_tokens(
            text=text_to_tokenize,
            provider_name=provider_name,
            model_name=model_name
        )
        logger.debug(f"Estimated {token_count} tokens for text (len: {len(text_to_tokenize)}) "
                     f"with provider '{provider_name}' (model: {model_name or 'default'}).")
        return jsonify({"token_count": token_count})
    except ProviderError as e:
        logger.error(f"ProviderError during token estimation for provider '{provider_name}': {e}", exc_info=True)
        return jsonify({"error": f"Provider error during token estimation: {str(e)}"}), 500
    except LLMCoreError as e: # Catch other LLMCore errors
        logger.error(f"LLMCoreError during token estimation for provider '{provider_name}': {e}", exc_info=True)
        return jsonify({"error": f"LLMCore error during token estimation: {str(e)}"}), 500
    except Exception as e_unexp:
        logger.error(f"Unexpected error during token estimation: {e_unexp}", exc_info=True)
        return jsonify({"error": "An unexpected server error occurred during token estimation."}), 500


logger.info("Core routes (index, /api/status, /api/command, /api/logs, /api/utils/estimate_tokens) defined on core_bp.")
