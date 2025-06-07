# llmchat_web/app.py
"""
Main Flask application file for llmchat-web.

This application initializes the Flask app, LLMCore, logging,
and registers blueprints for routing. Core route logic is now in the 'routes'
sub-package. LLMCore initialization is attempted at module load time
to support Gunicorn workers, in addition to being called by external
startup mechanisms or direct script execution.

SECRET_KEY Fallback Strategy:
To ensure session consistency across Gunicorn workers when FLASK_SECRET_KEY
environment variable is not set, a fallback secret key is generated once
when this module is first loaded (_generated_flask_secret_key_at_module_load).
All workers forked from the same Gunicorn master process will share this
fallback key, preventing session decryption issues. For production,
explicitly setting the FLASK_SECRET_KEY environment variable is still
the recommended best practice.
"""

# --- Start: Fix for direct script execution and relative imports ---
# This block MUST be at the very top of the file, before any other imports.
import os
import sys
from pathlib import Path # For more robust path manipulation

if __name__ == "__main__" and (__package__ is None or __package__ == ''):
    current_file_path = Path(__file__).resolve()
    package_dir = current_file_path.parent
    project_root = package_dir.parent
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))
    __package__ = package_dir.name
# --- End: Fix for direct script execution ---

import asyncio
import json
import logging
import secrets
import uuid
import threading # Added for thread-local event loop management
from functools import wraps
from typing import Any, Callable, Coroutine, Optional, Dict, Union, AsyncGenerator
from importlib.metadata import version, PackageNotFoundError

from flask import Flask, jsonify, render_template, request, Response, stream_with_context
from flask import session as flask_session # Alias for clarity
from llmcore import LLMCore, LLMCoreError, ConfigError as LLMCoreConfigError
from llmcore import ProviderError, ContextLengthError, SessionNotFoundError
from llmcore.models import Message as LLMCoreMessage, ChatSession as LLMCoreChatSession, Role as LLMCoreRole

# --- Application Version ---
try:
    APP_VERSION = version("llmchat-web")
except PackageNotFoundError:
    APP_VERSION = "0.6.2" # Updated version
    logging.getLogger("llmchat_web_startup").info(
        f"llmchat-web package not found, using fallback version: {APP_VERSION}."
    )

# --- Global LLMCore Instance ---
llmcore_instance: Optional[LLMCore] = None
llmcore_init_error: Optional[str] = None

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("llmchat_web")
logger.setLevel(logging.DEBUG)

# --- Flask App Initialization ---
app = Flask(__name__)

_generated_flask_secret_key_at_module_load = secrets.token_hex(32)
logger.info(f"Flask SECRET_KEY fallback generated at module load. For production, set FLASK_SECRET_KEY env var.")

app.config["SECRET_KEY"] = os.environ.get("FLASK_SECRET_KEY", _generated_flask_secret_key_at_module_load)
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("FLASK_ENV") == "production"
if os.environ.get("FLASK_SECRET_KEY"):
    logger.info("Using FLASK_SECRET_KEY environment variable for Flask session encryption.")
else:
    logger.warning("FLASK_SECRET_KEY environment variable not set. Using a randomly generated fallback key for Flask sessions. "
                   "This key will be consistent for all workers of this Gunicorn master process instance, "
                   "but will change on application restart if the env var remains unset. "
                   "Set FLASK_SECRET_KEY in your environment for stable production sessions.")

# --- LLMCore Initialization (Asynchronous) ---
async def initialize_llmcore_async() -> None:
    global llmcore_instance, llmcore_init_error
    if llmcore_instance is not None:
        logger.info("LLMCore instance already initialized.")
        return
    logger.info("Attempting to initialize LLMCore for llmchat-web...")
    try:
        llmcore_instance = await LLMCore.create()
        llmcore_logger = logging.getLogger("llmcore")
        if logger.isEnabledFor(logging.DEBUG):
            llmcore_logger.setLevel(logging.DEBUG)
            logger.info("LLMCore logger level set to DEBUG for web app based on llmchat_web settings.")
        else:
            llmcore_logger.setLevel(logging.INFO)
            logger.info("LLMCore logger level set to INFO for web app based on llmchat_web settings.")
        logger.info("LLMCore instance initialized successfully for llmchat-web.")
        llmcore_init_error = None
    except LLMCoreConfigError as e_conf:
        error_msg = f"LLMCore Configuration Error: {e_conf}. LLMCore functionality will be unavailable."
        logger.critical(error_msg, exc_info=True)
        llmcore_init_error = error_msg; llmcore_instance = None
    except LLMCoreError as e_core:
        error_msg = f"LLMCore Initialization Error: {e_core}. LLMCore functionality will be unavailable."
        logger.critical(error_msg, exc_info=True)
        llmcore_init_error = error_msg; llmcore_instance = None
    except Exception as e:
        error_msg = f"Unexpected error during LLMCore initialization: {e}. LLMCore functionality will be unavailable."
        logger.critical(error_msg, exc_info=True)
        llmcore_init_error = error_msg; llmcore_instance = None

# --- LLMCore Initialization (Attempt at module load for WSGI servers) ---
if llmcore_instance is None and llmcore_init_error is None:
    logger.info("Attempting LLMCore initialization at module load time (e.g., for Gunicorn/WSGI)...")
    try:
        asyncio.run(initialize_llmcore_async())
        if llmcore_instance: logger.info("LLMCore successfully initialized at module load.")
        elif llmcore_init_error: logger.error(f"LLMCore initialization at module load failed. Error: {llmcore_init_error}")
        else: logger.error("LLMCore initialization at module load did not set instance or error."); llmcore_init_error = "Unknown error during module load initialization."
    except RuntimeError as e_runtime_module_load:
        if "cannot be called when another loop is running" in str(e_runtime_module_load):
            logger.warning(f"Asyncio RuntimeError during LLMCore init at module load: {e_runtime_module_load}. Assuming outer mechanism handles init.")
        else:
            err_msg = f"Critical unhandled RuntimeError during LLMCore init at module load: {e_runtime_module_load}"
            logger.critical(err_msg, exc_info=True);
            if not llmcore_init_error: llmcore_init_error = err_msg
            llmcore_instance = None
    except Exception as e_module_load:
        err_msg = f"Unexpected error during LLMCore init at module load: {e_module_load}"
        logger.critical(err_msg, exc_info=True)
        if not llmcore_init_error: llmcore_init_error = err_msg
        llmcore_instance = None

# --- Flask Session Debug Logging ---
@app.before_request
def log_session_info_before_request():
    """Logs Flask session content at the beginning of each request for debugging."""
    if logger.isEnabledFor(logging.DEBUG): # Only log if debug is enabled for llmchat_web
        session_details_to_log = {
            "session_id_flask": flask_session.sid if hasattr(flask_session, 'sid') else 'N/A (default client-side session)',
            "current_llm_session_id_in_flask": flask_session.get('current_llm_session_id'),
            "current_provider_name_in_flask": flask_session.get('current_provider_name'),
            "current_model_name_in_flask": flask_session.get('current_model_name'),
            "rag_enabled_in_flask": flask_session.get('rag_enabled'),
            "rag_collection_name_in_flask": flask_session.get('rag_collection_name'),
            # Add other relevant session keys if needed
            "flask_session_full_content_keys": list(flask_session.keys())
        }
        logger.debug(f"FLASK_SESSION_STATE_SUMMARY (Before Request {request.path}): {session_details_to_log}")


# --- Thread-Safe Asyncio Event Loop Management ---
_thread_local = threading.local()

def get_or_create_event_loop() -> asyncio.AbstractEventLoop:
    """
    Gets or creates a new event loop for the current thread and sets it as the active loop.
    This ensures that each Flask worker thread has its own persistent event loop,
    avoiding "Event loop is closed" errors with stateful async libraries.
    """
    if not hasattr(_thread_local, 'loop') or _thread_local.loop.is_closed():
        logger.debug("Creating new persistent event loop for this thread.")
        _thread_local.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_thread_local.loop)
    return _thread_local.loop

# --- Async to Sync Wrappers for Flask Routes ---
def async_to_sync_in_flask(f: Callable[..., Coroutine[Any, Any, Any]]) -> Callable[..., Any]:
    """
    A decorator that allows running an async function from a synchronous Flask route.
    It gets or creates a persistent event loop for the current thread and uses it to
    run the async function.
    """
    @wraps(f)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        loop = get_or_create_event_loop()
        return loop.run_until_complete(f(*args, **kwargs))
    return wrapper

def run_async_generator_synchronously(async_gen_func: Callable[..., AsyncGenerator[str, None]], *args: Any, **kwargs: Any) -> Any:
    """
    Runs an asynchronous generator function synchronously from a synchronous context.
    This is necessary for streaming responses in Flask with `stream_with_context`.
    It uses the same thread-local event loop management as `async_to_sync_in_flask`.
    """
    utility_logger = logging.getLogger("llmchat_web.utils.async_gen_sync_runner")
    loop = get_or_create_event_loop()
    utility_logger.debug(f"Using thread-local event loop for run_async_generator_synchronously of {async_gen_func.__name__}")
    async_gen = async_gen_func(*args, **kwargs)
    while True:
        try:
            # Run the next step of the generator on the thread's persistent loop
            item = loop.run_until_complete(async_gen.__anext__())
            yield item
        except StopAsyncIteration:
            utility_logger.debug(f"Async generator {async_gen_func.__name__} completed.")
            break
        except Exception as e_inner:
            utility_logger.error(f"Error during iteration of async generator {async_gen_func.__name__}: {e_inner}", exc_info=True)
            break
    # The loop is intentionally not closed here, as it's managed per-thread.

# --- Session Helper Functions ---
def get_current_web_session_id() -> Optional[str]:
    return flask_session.get('current_llm_session_id')

def set_current_web_session_id(llmcore_session_id: Optional[str]):
    flask_session['current_llm_session_id'] = llmcore_session_id
    logger.debug(f"Flask session 'current_llm_session_id' set to: {llmcore_session_id}")

async def get_context_usage_info(session_id: Optional[str]) -> Optional[Dict[str, Any]]:
    if not llmcore_instance or not session_id: return None
    try:
        context_details = await llmcore_instance.get_last_interaction_context_info(session_id)
        if context_details:
            tokens_used = context_details.final_token_count if context_details.final_token_count is not None else 0
            max_tokens = context_details.max_tokens_for_model if context_details.max_tokens_for_model is not None else 0
            return {"tokens_used": tokens_used, "max_tokens": max_tokens, "usage_percentage": (tokens_used / max_tokens * 100) if max_tokens > 0 else 0}
    except Exception as e_ctx_info: logger.error(f"Error fetching context usage info for session {session_id}: {e_ctx_info}")
    return None

# --- Register Blueprints ---
from . import routes as routes_package
for bp in routes_package.all_blueprints:
    app.register_blueprint(bp)
    logger.info(f"Registered blueprint '{bp.name}' with url_prefix '{bp.url_prefix}'.")
logger.info(f"All blueprints from 'llmchat_web.routes' package registered.")

# --- Main Execution ---
if __name__ == "__main__":
    port = int(os.environ.get("FLASK_RUN_PORT", 5000))
    is_debug_mode = os.environ.get("FLASK_ENV", "production").lower() == "development"
    if llmcore_instance is None and llmcore_init_error is None:
        logger.info("Running LLMCore asynchronous initialization for direct app run...")
        try: asyncio.run(initialize_llmcore_async())
        except RuntimeError as e_runtime_direct:
            if "cannot be called when another loop is running" in str(e_runtime_direct): logger.warning(f"Asyncio loop already running (direct run), LLMCore init via asyncio.run skipped: {e_runtime_direct}.")
            else: logger.critical(f"Critical RuntimeError during LLMCore initialization (direct run): {e_runtime_direct}", exc_info=True);
            if not llmcore_init_error: llmcore_init_error = f"RuntimeError (direct run): {e_runtime_direct}"; llmcore_instance = None
        except Exception as e_startup_run_direct:
            logger.critical(f"Critical error during asyncio.run(initialize_llmcore_async) (direct run): {e_startup_run_direct}", exc_info=True)
            if not llmcore_init_error: llmcore_init_error = f"Failed during asyncio.run (direct run): {e_startup_run_direct}"; llmcore_instance = None
    logger.info(f"Starting llmchat-web Flask server directly on port {port} (Debug: {is_debug_mode})...")
    if llmcore_init_error and not llmcore_instance : logger.error(f"LLMCore failed to initialize: {llmcore_init_error}. Application might not function correctly.")
    elif not llmcore_instance: logger.warning("LLMCore instance not available at server start (direct run). Functionality will be limited.")
    else: logger.info("LLMCore instance is available for direct run.")
    app.run(host="0.0.0.0", port=port, debug=is_debug_mode)
