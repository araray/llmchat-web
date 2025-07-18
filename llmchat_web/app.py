# llmchat_web/app.py
"""
Flask application for the llmchat-web interface.

This is the main Flask application that provides a web interface for
interacting with LLMCore via its HTTP API. The application no longer
directly imports or manages LLMCore instances, instead communicating
through HTTP requests to the LLMCore API server.
"""

import asyncio
import logging
import os
import threading
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, Generator, Optional

from flask import Flask, session as flask_session

from .get_version import get_version
from .routes import all_blueprints

# Application version
APP_VERSION = get_version()

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("llmchat_web.app")

# Thread-local storage for event loops
_thread_locals = threading.local()


def get_or_create_event_loop() -> asyncio.AbstractEventLoop:
    """
    Get or create an event loop for the current thread.

    This is needed because Flask runs in multiple threads and each thread
    needs its own event loop for async operations.
    """
    try:
        return asyncio.get_event_loop()
    except RuntimeError:
        # No event loop in current thread, create one
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        return loop


def async_to_sync_in_flask(async_func):
    """
    Decorator to run async functions in Flask route handlers.

    This wrapper ensures that async functions can be called from
    synchronous Flask routes by managing the event loop properly.
    """
    def wrapper(*args, **kwargs):
        loop = get_or_create_event_loop()
        return loop.run_until_complete(async_func(*args, **kwargs))
    return wrapper


def run_async_generator_synchronously(async_gen_func, *args, **kwargs) -> Generator[str, None, None]:
    """
    Convert an async generator to a sync generator for Flask streaming.

    This is used for SSE (Server-Sent Events) streaming where we need to
    convert async generators from the API client to sync generators that
    Flask can stream to the client.
    """
    loop = get_or_create_event_loop()

    async def _run_async_gen():
        async for item in async_gen_func(*args, **kwargs):
            yield item

    async_gen = _run_async_gen()

    try:
        while True:
            try:
                item = loop.run_until_complete(async_gen.__anext__())
                yield item
            except StopAsyncIteration:
                break
    finally:
        loop.run_until_complete(async_gen.aclose())


def get_current_web_session_id() -> Optional[str]:
    """
    Get the current LLMCore session ID from Flask session.

    Returns:
        The session ID string or None if not set
    """
    return flask_session.get('current_llm_session_id')


def set_current_web_session_id(session_id: Optional[str]) -> None:
    """
    Set the current LLMCore session ID in Flask session.

    Args:
        session_id: The session ID to set, or None to clear
    """
    if session_id is None:
        flask_session.pop('current_llm_session_id', None)
    else:
        flask_session['current_llm_session_id'] = session_id


def create_app() -> Flask:
    """
    Create and configure the Flask application.

    Returns:
        Configured Flask application instance
    """
    app = Flask(__name__)

    # Configure Flask session
    app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'dev-key-change-in-production')

    # Register all blueprints
    for blueprint in all_blueprints:
        app.register_blueprint(blueprint)
        logger.info(f"Registered blueprint: {blueprint.name}")

    logger.info(f"llmchat-web v{APP_VERSION} Flask application created successfully")
    return app


# Create the Flask application instance
app = create_app()

if __name__ == "__main__":
    # Development server
    app.run(host="0.0.0.0", port=5000, debug=True)
