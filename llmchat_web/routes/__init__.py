# llmchat_web/routes/__init__.py
"""
Initialization module for the Flask routes sub-package.

This module defines and collects Blueprints for different parts of the
llmchat-web API. These blueprints are then registered with the main
Flask application.
"""
import logging
from flask import Blueprint

# --- Logger for this routes package ---
# Note: Child loggers inherit configuration from parent if not explicitly set.
# The main app logger is configured in app.py.
logger = logging.getLogger("llmchat_web.routes") # Parent logger for all route modules
# If app_logger is available and configured, this logger will use its settings.
# Individual route modules can create their own child loggers, e.g., logging.getLogger("llmchat_web.routes.chat")

# --- Blueprint Definitions ---
# These blueprints will be populated by their respective route modules.

# Blueprint for core functionalities (index, status, command)
# url_prefix will make all routes in this blueprint start with '/api/core'
# However, for index ('/') and status ('/api/status'), we want them at root or /api.
# So, we'll define core_bp without a url_prefix and handle prefixes in routes.
core_bp = Blueprint('core_bp', __name__)

# Blueprint for chat functionalities
chat_bp = Blueprint('chat_bp', __name__, url_prefix='/api/chat')

# Blueprint for session management (listing, creating, loading, deleting sessions and messages)
# URL prefix will be /api/sessions
session_bp = Blueprint('session_bp', __name__, url_prefix='/api/sessions')

# Blueprint for workspace and context management (workspace items, context preview)
# These are typically session-specific, so they might be nested or have session_id in their path.
# For now, let's assume routes will be like /api/sessions/<session_id>/workspace/...
# The Blueprint itself won't have /sessions/<session_id> in its prefix; routes will define that.
# Let's make a distinct prefix for workspace related actions if they are not directly under /api/sessions/
# For simplicity, we'll keep it under /api, and routes will handle session_id.
# No, let's make it more specific to avoid clashes and for clarity.
# The routes themselves will be like /<session_id>/workspace/...
# So, the blueprint can be /api/workspace and routes handle session_id, or
# we can make it part of session_bp if all workspace routes are /api/sessions/<sid>/workspace/...
# Given the original structure, workspace routes were /api/sessions/<session_id>/workspace/...
# So, these can logically belong to an extension of session_bp or a new one.
# Let's create a new one for clarity, and its routes will be defined relative to its prefix.
# The original routes were:
# /api/sessions/<session_id>/workspace/items
# /api/sessions/<session_id>/workspace/items/<item_id>
# /api/sessions/<session_id>/workspace/add_text
# /api/sessions/<session_id>/workspace/add_file
# /api/sessions/<session_id>/context/preview
# These seem to fit well under the session_bp if we make its routes more specific.
# Let's reconsider. For modularity, a separate workspace_bp might be cleaner.
# If workspace_bp has url_prefix='/api/sessions/<session_id>/workspace', Flask handles dynamic parts in prefix.
# However, Blueprint url_prefix usually doesn't have converters. Converters are for routes.
# So, workspace_bp will have routes like /<session_id>/workspace/items.
# Let's make workspace_bp have url_prefix='/api/workspace' and routes will be /<session_id>/items etc.
# Or, better: workspace_bp = Blueprint('workspace_bp', __name__, url_prefix='/api/sessions')
# and routes are /<session_id>/workspace/items. This seems cleaner.
workspace_bp = Blueprint('workspace_bp', __name__, url_prefix='/api/sessions') # Routes will add /<session_id>/workspace/*

# Blueprint for RAG (Retrieval Augmented Generation) functionalities
# Includes listing collections, updating RAG settings, direct search, and ingestion.
rag_bp = Blueprint('rag_bp', __name__, url_prefix='/api/rag')
ingest_bp = Blueprint('ingest_bp', __name__, url_prefix='/api/ingest') # Separate for /api/ingest

# Blueprint for application settings (LLM provider/model, system message, prompt template values)
# All start with /api/settings/...
settings_bp = Blueprint('settings_bp', __name__, url_prefix='/api/settings')


# --- Import route modules to register their routes with the blueprints ---
# These imports will be added as each route file is created.
# Example: from . import core_routes, chat_routes, etc.

# For now, this file just defines the blueprints.
# The main app.py will import these blueprints and register them.

# List of all blueprints to be registered by the app
all_blueprints = [
    core_bp,
    chat_bp,
    session_bp,
    workspace_bp,
    rag_bp,
    ingest_bp,
    settings_bp,
]

logger.info(f"Defined {len(all_blueprints)} blueprints for llmchat_web routes.")

# The actual route definitions will be in separate files like:
# llmchat_web/routes/core_routes.py
# llmchat_web/routes/chat_routes.py
# ... and so on.
# Each of those files will import its respective blueprint from this __init__.py
# (e.g., from . import core_bp) and then define routes on it.

# This __init__.py will then need to import those modules so that the routes
# get registered when the package is imported.
# For example:
# from . import core_routes # This line executes core_routes.py, registering its routes.
# from . import chat_routes
# ... etc.
# This will be done after creating those files.
