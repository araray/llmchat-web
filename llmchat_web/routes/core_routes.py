# llmchat_web/routes/core_routes.py
"""
Core Flask routes for the llmchat-web application.
Handles serving the main page, API status, and utility functions.
"""
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
from pathlib import Path
import os

from flask import jsonify, render_template, request
from flask import session as flask_session

from . import core_bp
from ..app import (
    async_to_sync_in_flask,
    get_current_web_session_id,
    set_current_web_session_id,
    logger as app_logger,
    APP_VERSION
)
from ..services import LLMCoreAPIClient

logger = logging.getLogger("llmchat_web.routes.core")
if not logger.handlers and app_logger:
    logger.parent = logging.getLogger("llmchat_web.routes")
    if logger.parent and logger.parent.level:
        logger.setLevel(logger.parent.level)
    else:
        logger.setLevel(app_logger.level if app_logger else logging.DEBUG)


@core_bp.route("/")
def index() -> str:
    """
    Serves the main HTML page for the llmchat-web interface.
    Initializes Flask session variables if not already set.
    """
    logger.debug(f"Serving index.html. LLMCore API client will be used for backend communication.")

    if 'current_llm_session_id' not in flask_session:
        new_temp_id = f"web_initial_session_{uuid.uuid4().hex[:8]}"
        set_current_web_session_id(new_temp_id)
        logger.info(f"No LLMCore session ID in Flask session. Initialized with temporary ID: {new_temp_id}")

    # Initialize session settings with defaults since we no longer have direct config access
    if 'rag_enabled' not in flask_session:
        flask_session['rag_enabled'] = False
        logger.debug(f"Flask session 'rag_enabled' initialized to: {flask_session['rag_enabled']}")

    if 'rag_collection_name' not in flask_session:
        flask_session['rag_collection_name'] = None
        logger.debug(f"Flask session 'rag_collection_name' initialized to: {flask_session['rag_collection_name']}")

    if 'rag_k_value' not in flask_session:
        flask_session['rag_k_value'] = 3
        logger.debug(f"Flask session 'rag_k_value' initialized to: {flask_session['rag_k_value']}")

    if 'rag_filter' not in flask_session:
        flask_session['rag_filter'] = None
        logger.debug("Flask session 'rag_filter' initialized to None.")

    # Initialize LLM settings - these will be populated via API calls
    if 'current_provider_name' not in flask_session:
        flask_session['current_provider_name'] = None
        logger.debug(f"Flask session 'current_provider_name' initialized to None")

    if 'current_model_name' not in flask_session:
        flask_session['current_model_name'] = None
        logger.debug(f"Flask session 'current_model_name' initialized to None")

    if 'system_message' not in flask_session:
        flask_session['system_message'] = ""
        logger.debug(f"Flask session 'system_message' initialized to empty string")

    if 'prompt_template_values' not in flask_session:
        flask_session['prompt_template_values'] = {}
        logger.debug("Flask session 'prompt_template_values' initialized to empty dict.")

    flask_session.modified = True
    return render_template("index.html", app_version=APP_VERSION)


@core_bp.route("/api/status", methods=["GET"])
@async_to_sync_in_flask
async def api_status() -> Any:
    """
    API endpoint to check the status of the backend and LLMCore API.
    Returns current provider/model, session ID, and application version.
    """
    # --- Rationale Block: API-based Status Checking ---
    # Pre-state: The status endpoint directly checked llmcore_instance health
    #            and accessed configuration through the library interface.
    # Limitation: Direct coupling prevented deployment independence and required
    #             the web service to initialize the full LLMCore library.
    # Decision Path: Replace direct instance checks with HTTP health checks to
    #                the LLMCore API server. Configuration details are no longer
    #                directly accessible, so we focus on API connectivity status.
    # Post-state: Status endpoint now verifies API connectivity and returns
    #             web service state, enabling true service separation.

    api_client = LLMCoreAPIClient()

    # Check LLMCore API health
    try:
        health_info = await api_client.get_health()
        llmcore_status_val = "operational" if health_info.get("status") == "healthy" else "degraded"
        llmcore_error_detail_val = health_info.get("error")
    except Exception as e:
        llmcore_status_val = "error"
        llmcore_error_detail_val = str(e)
        logger.error(f"Failed to check LLMCore API health: {e}")

    current_provider_val = flask_session.get('current_provider_name')
    current_model_val = flask_session.get('current_model_name')
    current_session_id_val = get_current_web_session_id()
    rag_enabled_val = flask_session.get('rag_enabled', False)
    rag_collection_name_val = flask_session.get('rag_collection_name')
    rag_k_val = flask_session.get('rag_k_value')
    rag_filter_val = flask_session.get('rag_filter')
    system_message_val = flask_session.get('system_message', "")
    prompt_template_values_val = flask_session.get('prompt_template_values', {})

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
        "context_usage": None,  # Will be implemented when context API endpoints are available
    }

    logger.debug(f"API Status Check. LLMCore: {llmcore_status_val}. Session: {current_session_id_val}")
    return jsonify(status_payload)


@core_bp.route("/api/command", methods=["POST"])
@async_to_sync_in_flask
async def api_command_route() -> Any:
    """
    Handles commands submitted from the UI's command tab.
    This is a placeholder implementation for future command-line like interactions.
    """
    data = request.json
    if not data or "command" not in data:
        logger.warning("Command API called without 'command' field in JSON payload.")
        return jsonify({"error": "No command provided."}), 400

    command_text: str = data["command"]
    logger.info(f"Received command via API: '{command_text}'")

    response_output = f"Command received: '{command_text}'. (Execution placeholder - API client integration pending)"
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
    """
    log_lines_to_fetch = request.args.get("lines", 200, type=int)
    max_lines_cap = 2000
    if log_lines_to_fetch <= 0:
        log_lines_to_fetch = 200
    elif log_lines_to_fetch > max_lines_cap:
        log_lines_to_fetch = max_lines_cap
        logger.info(f"Requested log lines ({request.args.get('lines')}) exceeded cap, using {max_lines_cap}.")

    log_file_name = "llmchat_web_daemon.stderr.log"

    try:
        from appdirs import user_config_dir
        app_config_dir = Path(user_config_dir("llmchat", appauthor=False))
        log_file_path = app_config_dir / "logs" / log_file_name
        logger.debug(f"Constructed log file path using appdirs: {log_file_path}")
    except ImportError:
        logger.warning("'appdirs' library not found. Falling back to manual path construction for logs.")
        log_file_path = Path(os.path.expanduser("~/.config/llmchat/logs/" + log_file_name))
    except Exception as e_appdirs:
        logger.error(f"Error using appdirs to determine log path: {e_appdirs}. Falling back.")
        log_file_path = Path(os.path.expanduser("~/.config/llmchat/logs/" + log_file_name))

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
def estimate_tokens_route() -> Any:
    """
    API endpoint to estimate token count - currently stubbed.
    Will be implemented when the corresponding LLMCore API endpoint is available.
    """
    data = request.json
    if not data or "text" not in data or "provider_name" not in data:
        logger.warning("Token estimation API called without required fields.")
        return jsonify({"error": "Missing required fields: 'text' and 'provider_name'."}), 400

    # Stub implementation - return approximate estimate based on character count
    text_length = len(data["text"])
    estimated_tokens = max(1, text_length // 4)  # Rough approximation

    logger.debug(f"Stubbed token estimation: {estimated_tokens} tokens for text length {text_length}")
    return jsonify({
        "token_count": estimated_tokens,
        "note": "This is a rough estimate. Precise tokenization will be available when LLMCore API endpoint is implemented."
    })


def _scan_for_themes(theme_dir: Path, is_custom: bool) -> List[Dict[str, Any]]:
    """
    Scans a directory for .css files to be used as themes.
    """
    themes = []
    if not theme_dir.is_dir():
        if is_custom:
            logger.info(f"Custom themes directory not found at '{theme_dir}', which is acceptable. Skipping.")
        else:
            logger.warning(f"Built-in themes directory not found at '{theme_dir}'.")
        return themes

    try:
        for f in theme_dir.iterdir():
            if f.is_file() and f.suffix == '.css':
                theme_id = f.stem
                theme_name = theme_id.replace('_', ' ').replace('-', ' ').title()
                themes.append({"id": theme_id, "name": theme_name, "is_custom": is_custom})
    except OSError as e:
        logger.error(f"Error scanning theme directory '{theme_dir}': {e}", exc_info=True)

    return sorted(themes, key=lambda x: x['name'])


@core_bp.route("/api/themes", methods=["GET"])
def api_themes_route() -> Any:
    """
    API endpoint to discover and list available CSS themes.
    """
    try:
        static_folder = Path(__file__).resolve().parent.parent / 'static'
        base_css_path = static_folder / 'css'

        default_themes = [
            {"id": "dark", "name": "Dark", "is_custom": False},
        ]

        builtin_themes_dir = base_css_path / 'themes'
        builtin_themes = _scan_for_themes(builtin_themes_dir, is_custom=False)

        custom_themes_dir = base_css_path / 'custom_themes'
        custom_themes = _scan_for_themes(custom_themes_dir, is_custom=True)

        all_themes = default_themes + builtin_themes + custom_themes
        unique_themes_dict = {theme['id']: theme for theme in all_themes}
        final_themes = sorted(list(unique_themes_dict.values()), key=lambda x: x['name'])

        return jsonify({"themes": final_themes})
    except Exception as e:
        logger.error(f"Unexpected error in /api/themes endpoint: {e}", exc_info=True)
        return jsonify({"error": "An unexpected server error occurred while discovering themes."}), 500


logger.info("Core routes (index, /api/status, /api/command, /api/logs, /api/utils/estimate_tokens, /api/themes) defined on core_bp.")
