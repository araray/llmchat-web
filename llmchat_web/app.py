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
import json # Retained for potential direct use
import logging
import secrets # Used for Flask secret key
import uuid # Used for generating session IDs
from functools import wraps # For decorators
from typing import Any, Callable, Coroutine, Optional, Dict, Union, AsyncGenerator # Type hinting
from importlib.metadata import version, PackageNotFoundError # Added for app versioning

from flask import Flask, jsonify, render_template, request, Response, stream_with_context # Blueprint removed
from flask import session as flask_session # Alias to avoid confusion with LLMCore's session
from llmcore import LLMCore, LLMCoreError, ConfigError as LLMCoreConfigError
from llmcore import ProviderError, ContextLengthError, SessionNotFoundError
from llmcore.models import Message as LLMCoreMessage, ChatSession as LLMCoreChatSession, Role as LLMCoreRole

# --- Application Version ---
try:
    # Get version from this package's metadata
    APP_VERSION = version("llmchat-web")
except PackageNotFoundError:
    # Fallback version if llmchat-web is not installed (e.g., running source directly)
    APP_VERSION = "0.2.9-dev" # Ensure this matches the intended version in pyproject.toml
    logging.getLogger("llmchat_web_startup").info(
        f"llmchat-web package not found (or not installed), using fallback version: {APP_VERSION}. "
        "This is normal if running directly from source without installation."
    )


# --- Global LLMCore Instance ---
# This instance will be imported by route modules within the 'routes' package.
llmcore_instance: Optional[LLMCore] = None
llmcore_init_error: Optional[str] = None # Renamed for clarity from global_llmcore_init_error

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

# --- Generate Flask SECRET_KEY fallback once at module load ---
# This ensures all Gunicorn workers share the same fallback key if
# FLASK_SECRET_KEY environment variable is not set.
_generated_flask_secret_key_at_module_load = secrets.token_hex(32)
logger.info(f"Flask SECRET_KEY fallback generated at module load. For production, set FLASK_SECRET_KEY env var.")


# --- Flask Configuration ---
# Use the pre-generated key if FLASK_SECRET_KEY env var is not set
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
    """
    Asynchronously initializes the global LLMCore instance.
    This function is called at application startup.
    It sets the global `llmcore_instance` and `llmcore_init_error`.
    """
    global llmcore_instance, llmcore_init_error # Explicitly declare intent to modify globals
    if llmcore_instance is not None:
        logger.info("LLMCore instance already initialized.")
        return
    logger.info("Attempting to initialize LLMCore for llmchat-web...")
    try:
        # LLMCore.create() will use its own configuration mechanisms.
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
        llmcore_instance = None # Ensure instance is None on error
    except LLMCoreError as e_core:
        error_msg = f"LLMCore Initialization Error: {e_core}. LLMCore functionality will be unavailable."
        logger.critical(error_msg, exc_info=True)
        llmcore_init_error = error_msg
        llmcore_instance = None # Ensure instance is None on error
    except Exception as e:
        error_msg = f"Unexpected error during LLMCore initialization: {e}. LLMCore functionality will be unavailable."
        logger.critical(error_msg, exc_info=True)
        llmcore_init_error = error_msg
        llmcore_instance = None # Ensure instance is None on error

# --- LLMCore Initialization (Attempt at module load for WSGI servers like Gunicorn) ---
# This section is crucial for Gunicorn workers to get an initialized LLMCore.
# It runs when the module is first imported.
# The `if llmcore_instance is None and llmcore_init_error is None:` check prevents
# re-initialization if already done (e.g., by an external script) or if it failed.
if llmcore_instance is None and llmcore_init_error is None:
    logger.info("Attempting LLMCore initialization at module load time (e.g., for Gunicorn/WSGI)...")
    try:
        # For WSGI servers like Gunicorn (with sync workers),
        # each worker process will import this module.
        # asyncio.run() will create a new event loop, run the async init, and close the loop.
        # This is generally safe for Gunicorn's default sync workers.
        asyncio.run(initialize_llmcore_async())
        if llmcore_instance:
            logger.info("LLMCore successfully initialized at module load.")
        elif llmcore_init_error: # Check if init function set an error
            logger.error(f"LLMCore initialization at module load failed. Error: {llmcore_init_error}")
        else:
            # This case should ideally not be reached if initialize_llmcore_async behaves as expected
            logger.error("LLMCore initialization at module load did not set instance or error.")
            llmcore_init_error = "Unknown error during module load initialization."

    except RuntimeError as e_runtime_module_load:
        # This might happen if something else already started an asyncio loop in this context.
        # For example, if Gunicorn is run with async workers (uvicorn.workers.UvicornWorker)
        # and that worker has already started a loop.
        if "cannot be called when another loop is running" in str(e_runtime_module_load):
            logger.warning(
                f"Asyncio RuntimeError during LLMCore init at module load: {e_runtime_module_load}. "
                "This may be okay if an outer mechanism (e.g., ASGI server or web_commands.py) "
                "is responsible for initialization within an existing loop."
            )
            # In this specific scenario, we don't set llmcore_init_error,
            # as another part of the system might be about to initialize it.
            # If it doesn't, the app will fail later, but this avoids a premature error state here.
        else:
            err_msg = f"Critical unhandled RuntimeError during LLMCore init at module load: {e_runtime_module_load}"
            logger.critical(err_msg, exc_info=True)
            if not llmcore_init_error: llmcore_init_error = err_msg
            llmcore_instance = None
    except Exception as e_module_load:
        err_msg = f"Unexpected error during LLMCore init at module load: {e_module_load}"
        logger.critical(err_msg, exc_info=True)
        if not llmcore_init_error: llmcore_init_error = err_msg
        llmcore_instance = None


# --- Async to Sync Wrapper for Flask Routes (used by route modules) ---
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

        if loop is None: # Should not happen if new_event_loop succeeds
             logger.error("Failed to obtain an event loop for async_to_sync_in_flask.")
             # Consider raising an error or returning a Flask error response
             raise RuntimeError("Failed to obtain an event loop for an async operation.")
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
                    # Reset the event loop policy's current loop if we set it and closed it.
                    # This helps avoid issues if other parts of the code try to get_event_loop() later.
                    if asyncio.get_event_loop_policy().get_event_loop() is loop:
                         asyncio.set_event_loop(None)
            elif not created_loop:
                 logger.debug("Not closing event loop as it was pre-existing and is managed elsewhere.")
    return wrapper

# --- Session Helper Functions (used by route modules) ---
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


# --- Register Blueprints from the 'routes' sub-package ---
# Import the routes sub-package. This will execute llmchat_web/routes/__init__.py,
# which in turn should import all individual route modules (once they are created),
# causing routes to be registered on the blueprints defined there.
from . import routes as routes_package # 'routes' is now a package

# Register all blueprints defined in routes_package.all_blueprints
for bp in routes_package.all_blueprints:
    app.register_blueprint(bp)
    logger.info(f"Registered blueprint '{bp.name}' with url_prefix '{bp.url_prefix}'.")

logger.info(f"All blueprints from 'llmchat_web.routes' package registered.")


# --- Main Execution (for direct run, e.g., python -m llmchat_web.app) ---
if __name__ == "__main__":
    port = int(os.environ.get("FLASK_RUN_PORT", 5000))
    is_debug_mode = os.environ.get("FLASK_ENV", "production").lower() == "development"

    # LLMCore initialization for direct run.
    # The module-level initialization attempt above handles the Gunicorn case.
    # This ensures initialization if app.py is run directly and module-level one was skipped or needs re-attempt.
    if llmcore_instance is None and llmcore_init_error is None:
        logger.info("Running LLMCore asynchronous initialization for direct app run (if not already done)...")
        try:
            asyncio.run(initialize_llmcore_async())
        except RuntimeError as e_runtime_direct:
            if "cannot be called when another loop is running" in str(e_runtime_direct):
                logger.warning(
                    f"Asyncio loop already running (direct run), LLMCore init via asyncio.run skipped: {e_runtime_direct}. "
                    "Assuming it was initialized by module-level attempt or other means."
                )
            else:
                logger.critical(f"Critical RuntimeError during LLMCore initialization (direct run): {e_runtime_direct}", exc_info=True)
                if not llmcore_init_error: llmcore_init_error = f"RuntimeError during LLMCore init (direct run): {e_runtime_direct}"
                llmcore_instance = None
        except Exception as e_startup_run_direct:
            logger.critical(f"Critical error during asyncio.run(initialize_llmcore_async) (direct run): {e_startup_run_direct}", exc_info=True)
            if not llmcore_init_error: llmcore_init_error = f"Failed during asyncio.run (direct run): {e_startup_run_direct}"
            llmcore_instance = None

    logger.info(f"Starting llmchat-web Flask server directly on port {port} (Debug: {is_debug_mode})...")
    if llmcore_init_error and not llmcore_instance : # Only log critical error if instance is still None
        logger.error(f"LLMCore failed to initialize: {llmcore_init_error}. The application might not function correctly.")
    elif not llmcore_instance:
        logger.warning("LLMCore instance is not available at server start (direct run), despite initialization attempts. Functionality will be limited.")
    else:
        logger.info("LLMCore instance is available for direct run.")


    app.run(host="0.0.0.0", port=port, debug=is_debug_mode)
