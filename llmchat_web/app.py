# llmchat_web/app.py
"""
Main Flask application file for llmchat-web.

This application initializes the Flask app, LLMCore, logging,
and registers blueprints for routing. Core route logic is now in routes.py.
The main_bp Blueprint is now defined here to avoid circular imports.
LLMCore initialization is now deferred and called by the startup mechanism
(e.g., web_commands.py or direct run).
"""

# --- Start: Fix for direct script execution and relative imports ---
# This block MUST be at the very top of the file, before any other imports.
import os
import sys
from pathlib import Path # For more robust path manipulation

if __name__ == "__main__" and (__package__ is None or __package__ == ''):
    # This script is being run directly.
    # Path to the current file (app.py)
    current_file_path = Path(__file__).resolve()
    # Path to the 'llmchat_web' directory (which is the package for app.py)
    package_dir = current_file_path.parent
    # Path to the project root (parent of 'llmchat_web')
    project_root = package_dir.parent

    # Add project root to sys.path so 'llmchat_web' (and 'llmchat') can be imported
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))
        # print(f"[DEBUG app.py sys.path fix] Added project root to sys.path: {project_root}", file=sys.stderr)

    # Explicitly set __package__ to the name of the package directory.
    # This allows relative imports (from .routes) within this script to work.
    __package__ = package_dir.name # Should be 'llmchat_web'
    # print(f"[DEBUG app.py sys.path fix] Set __package__ to: {__package__}", file=sys.stderr)
# --- End: Fix for direct script execution ---

import asyncio
import json # Retained for potential direct use, though routes handle most JSON
import logging
import secrets # Used for Flask secret key
import uuid # Used for generating session IDs
from functools import wraps # For decorators
from typing import Any, Callable, Coroutine, Optional, Dict, Union, AsyncGenerator # Type hinting

from flask import Flask, jsonify, render_template, request, Response, stream_with_context, Blueprint
from flask import session as flask_session # Alias to avoid confusion with LLMCore's session
from llmcore import LLMCore, LLMCoreError, ConfigError as LLMCoreConfigError
from llmcore import ProviderError, ContextLengthError, SessionNotFoundError
from llmcore.models import Message as LLMCoreMessage, ChatSession as LLMCoreChatSession, Role as LLMCoreRole

# --- Application Version ---
try:
    # Assuming llmchat is installed or in PYTHONPATH if this web app is part of it
    from llmchat import __version__ as APP_VERSION
except ImportError:
    # Fallback version if llmchat package is not found (e.g., running llmchat_web standalone)
    APP_VERSION = "0.19.37-web"
    # Log this situation as it might indicate an improper setup for a combined project
    logging.getLogger("llmchat_web_startup").warning(
        "Could not import __version__ from 'llmchat' package. Using fallback version. "
        "Ensure 'llmchat' is installed or project structure allows this import if intended."
    )


# --- Global LLMCore Instance ---
# This instance will be imported by routes.py
llmcore_instance: Optional[LLMCore] = None
llmcore_init_error: Optional[str] = None

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO, # Default to INFO
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("llmchat_web") # Main web app logger
logger.setLevel(logging.DEBUG) # Keep debug for web development, can be configured

# --- Flask App Initialization ---
app = Flask(__name__)

# Define the main Blueprint here to be imported by routes.py
main_bp = Blueprint('main_bp', __name__)


# --- Flask Configuration ---
app.config["SECRET_KEY"] = os.environ.get("FLASK_SECRET_KEY", secrets.token_hex(32))
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("FLASK_ENV") == "production"


# --- LLMCore Initialization (Asynchronous) ---
async def initialize_llmcore_async() -> None:
    """
    Asynchronously initializes the global LLMCore instance.
    This function is called at application startup (e.g., by web_commands.py or direct run).
    It sets the global `llmcore_instance` and `llmcore_init_error`.
    """
    global llmcore_instance, llmcore_init_error
    if llmcore_instance is not None:
        logger.info("LLMCore instance already initialized.")
        return
    logger.info("Attempting to initialize LLMCore for llmchat-web...")
    try:
        llmcore_instance = await LLMCore.create()

        llmcore_logger = logging.getLogger("llmcore")
        if logger.isEnabledFor(logging.DEBUG): # llmchat_web's logger
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
        llmcore_init_error = error_msg
    except LLMCoreError as e_core:
        error_msg = f"LLMCore Initialization Error: {e_core}. LLMCore functionality will be unavailable."
        logger.critical(error_msg, exc_info=True)
        llmcore_init_error = error_msg
    except Exception as e:
        error_msg = f"Unexpected error during LLMCore initialization: {e}. LLMCore functionality will be unavailable."
        logger.critical(error_msg, exc_info=True)
        llmcore_init_error = error_msg

# --- Async to Sync Wrapper for Flask Routes (used by routes.py) ---
def async_to_sync_in_flask(f: Callable[..., Coroutine[Any, Any, Any]]) -> Callable[..., Any]:
    """
    Decorator to run an async function synchronously in a Flask context.
    Manages an event loop for the execution of the async function.
    Ensures robust loop creation and cleanup.
    """
    @wraps(f)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        loop: Optional[asyncio.AbstractEventLoop] = None
        created_loop = False
        try:
            loop = asyncio.get_running_loop()
            logger.debug("Found existing running event loop for async_to_sync_in_flask.")
        except RuntimeError:
            logger.debug("No running event loop, creating new one for async_to_sync_in_flask.")
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            created_loop = True

        if loop is None:
             logger.error("Failed to obtain an event loop for async_to_sync_in_flask.")
             raise RuntimeError("Failed to obtain an event loop.")
        try:
            return loop.run_until_complete(f(*args, **kwargs))
        finally:
            if created_loop and not loop.is_closed():
                logger.debug("Closing event loop created by async_to_sync_in_flask.")
                try:
                    async def _shutdown_loop_tasks(current_loop: asyncio.AbstractEventLoop):
                        tasks = [t for t in asyncio.all_tasks(loop=current_loop) if t is not asyncio.current_task(loop=current_loop)]
                        if tasks:
                            logger.debug(f"Cancelling {len(tasks)} outstanding tasks in created loop.")
                            for task in tasks: task.cancel()
                            await asyncio.gather(*tasks, return_exceptions=True)
                        logger.debug("Shutting down async generators in created loop.")
                        await current_loop.shutdown_asyncgens()
                    loop.run_until_complete(_shutdown_loop_tasks(loop))
                except Exception as e_shutdown:
                    logger.error(f"Error during shutdown of tasks/asyncgens in created loop: {e_shutdown}")
                finally:
                    loop.close()
                    logger.debug("Event loop created by wrapper closed.")
                    if asyncio.get_event_loop_policy().get_event_loop() is loop:
                         asyncio.set_event_loop(None)
            elif not created_loop:
                 logger.debug("Not closing event loop as it was pre-existing and is managed elsewhere.")
    return wrapper

# --- Session Helper Functions (used by routes.py) ---
def get_current_web_session_id() -> Optional[str]:
    """Retrieves the LLMCore session ID stored in the Flask session."""
    return flask_session.get('current_llm_session_id')

def set_current_web_session_id(llmcore_session_id: Optional[str]):
    """Sets the LLMCore session ID in the Flask session."""
    flask_session['current_llm_session_id'] = llmcore_session_id
    logger.debug(f"Flask session 'current_llm_session_id' set to: {llmcore_session_id}")

async def get_context_usage_info(session_id: Optional[str]) -> Optional[Dict[str, Any]]:
    """
    Helper to fetch and format context usage info from LLMCore.
    This is used by chat routes to update the UI.
    """
    if not llmcore_instance or not session_id:
        return None
    try:
        context_details = await llmcore_instance.get_last_interaction_context_info(session_id)
        if context_details:
            tokens_used = context_details.final_token_count if context_details.final_token_count is not None else 0
            max_tokens = context_details.max_tokens_for_model if context_details.max_tokens_for_model is not None else 0
            return {
                "tokens_used": tokens_used,
                "max_tokens": max_tokens,
                "usage_percentage": (tokens_used / max_tokens * 100) if max_tokens > 0 else 0
            }
    except Exception as e_ctx_info:
        logger.error(f"Error fetching context usage info for session {session_id}: {e_ctx_info}")
    return None


# --- Application Startup: LLMCore Initialization ---
# REMOVED: asyncio.run(initialize_llmcore_async())
# LLMCore will be initialized by the server startup mechanism (e.g., web_commands.py)


# --- Register Blueprints ---
# Import routes AFTER app, main_bp are defined.
# llmcore_instance will be None here, but routes.py checks for it at runtime.
from . import routes  # This executes routes.py, attaching routes to main_bp
app.register_blueprint(main_bp) # Register the blueprint that routes.py has now populated
logger.info("Main blueprint registered.")


# --- Main Execution (for direct run, e.g., python llmchat_web/app.py) ---
if __name__ == "__main__":
    port = int(os.environ.get("FLASK_RUN_PORT", 5000))
    is_debug_mode = os.environ.get("FLASK_ENV", "production").lower() == "development"

    # Initialize LLMCore synchronously for direct run
    logger.info("Running LLMCore asynchronous initialization for direct app run...")
    try:
        asyncio.run(initialize_llmcore_async())
    except RuntimeError as e_runtime_direct:
        if "cannot be called when another loop is running" in str(e_runtime_direct):
            logger.warning(f"Asyncio loop already running (direct run), attempting to schedule LLMCore init: {e_runtime_direct}")
            # This case is complex for direct run; usually means it's embedded.
            # For simple `python app.py`, new_event_loop should work.
            # If it's truly nested, the outer loop should manage.
            # The primary fix is for daemon mode.
            pass
        else:
            logger.critical(f"Critical RuntimeError during LLMCore initialization (direct run): {e_runtime_direct}", exc_info=True)
            if not llmcore_init_error: llmcore_init_error = f"RuntimeError during LLMCore init (direct run): {e_runtime_direct}"
    except Exception as e_startup_run_direct:
        logger.critical(f"Critical error during asyncio.run(initialize_llmcore_async) (direct run): {e_startup_run_direct}", exc_info=True)
        if not llmcore_init_error: llmcore_init_error = f"Failed during asyncio.run (direct run): {e_startup_run_direct}"


    logger.info(f"Starting llmchat-web Flask server directly on port {port} (Debug: {is_debug_mode})...")
    if llmcore_init_error:
        logger.error(f"LLMCore failed to initialize: {llmcore_init_error}. The application might not function correctly.")
    elif not llmcore_instance:
        logger.warning("LLMCore instance is not available at server start (direct run). Functionality will be limited.")

    app.run(host="0.0.0.0", port=port, debug=is_debug_mode)
