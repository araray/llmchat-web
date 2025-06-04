# llmchat_web/routes/settings_routes.py
"""
Flask routes for managing application and session settings in llmchat-web.
Handles selection of LLM providers and models, system messages,
and RAG prompt template values.
"""
import logging
from typing import Any, Dict, Optional # Added Optional for type hinting

from flask import jsonify, request
from flask import session as flask_session

# Import the specific blueprint defined in the routes package's __init__.py
from . import settings_bp

# Import shared components from the main app module (llmchat_web.app)
from ..app import (
    llmcore_instance,
    async_to_sync_in_flask, # Though not all routes here are async, good for consistency if needed
    logger as app_logger # Main app logger
)

# Import specific LLMCore exceptions (not strictly needed for these routes but good practice)
from llmcore import LLMCoreError # For error handling consistency

# Configure a local logger for this specific routes module
logger = logging.getLogger("llmchat_web.routes.settings")
if not logger.handlers and app_logger:
    logger.parent = logging.getLogger("llmchat_web.routes")
    if logger.parent and logger.parent.level:
        logger.setLevel(logger.parent.level)
    else:
        logger.setLevel(app_logger.level if app_logger else logging.DEBUG)


# --- LLM Settings API Endpoints ---
# settings_bp has url_prefix='/api/settings'.

@settings_bp.route("/llm/providers", methods=["GET"])
@async_to_sync_in_flask # LLMCore methods might be async
async def get_llm_providers_route() -> Any:
    """
    Lists available LLM providers configured in LLMCore.
    Accessible at GET /api/settings/llm/providers.
    """
    if not llmcore_instance:
        logger.error("Attempted to list LLM providers, but LLM service is not available.")
        return jsonify({"error": "LLM service not available."}), 503
    try:
        logger.debug("Fetching available LLM providers from LLMCore.")
        providers = llmcore_instance.get_available_providers() # This method is synchronous in LLMCore
        logger.info(f"Successfully listed {len(providers)} LLM providers.")
        return jsonify(providers)
    except LLMCoreError as e: # Catch ConfigError or other LLMCore issues
        logger.error(f"Error listing LLM providers: {e}", exc_info=True)
        return jsonify({"error": f"Failed to list LLM providers: {str(e)}"}), 500
    except Exception as e_unexp:
        logger.error(f"Unexpected error listing LLM providers: {e_unexp}", exc_info=True)
        return jsonify({"error": "An unexpected server error occurred."}), 500


@settings_bp.route("/llm/providers/<provider_name>/models", methods=["GET"])
@async_to_sync_in_flask # LLMCore methods might be async
async def get_llm_models_route(provider_name: str) -> Any:
    """
    Lists available models for a specific LLM provider from LLMCore.
    Accessible at GET /api/settings/llm/providers/<provider_name>/models.
    """
    if not llmcore_instance:
        logger.error(f"Attempted to list models for provider {provider_name}, but LLM service is not available.")
        return jsonify({"error": "LLM service not available."}), 503
    try:
        logger.debug(f"Fetching models for LLM provider: {provider_name}")
        # This method is synchronous in LLMCore
        models = llmcore_instance.get_models_for_provider(provider_name)
        logger.info(f"Successfully listed {len(models)} models for provider {provider_name}.")
        return jsonify(models)
    except LLMCoreError as e: # Catches ConfigError if provider not found, or other issues
        logger.error(f"Error listing models for provider {provider_name}: {e}", exc_info=True)
        return jsonify({"error": f"Failed to list models for provider '{provider_name}': {str(e)}"}), 500
    except Exception as e_unexp:
        logger.error(f"Unexpected error listing models for provider {provider_name}: {e_unexp}", exc_info=True)
        return jsonify({"error": "An unexpected server error occurred."}), 500


@settings_bp.route("/llm/update", methods=["POST"])
def update_llm_settings_route() -> Any:
    """
    Updates the current LLM provider and model in the Flask session.
    Accessible at POST /api/settings/llm/update.
    Expects JSON payload: {"provider_name": "string", "model_name": "string_or_null"}
    """
    data = request.json
    if not data:
        logger.warning("Update LLM settings called with no JSON data.")
        return jsonify({"error": "No data provided."}), 400

    new_provider_name: Optional[str] = data.get('provider_name')
    new_model_name: Optional[str] = data.get('model_name') # Can be empty string or null from JS

    if not new_provider_name: # Provider name is mandatory
        logger.warning("Update LLM settings called without 'provider_name'.")
        return jsonify({"error": "Provider name is required to update LLM settings."}), 400

    flask_session['current_provider_name'] = new_provider_name
    # If new_model_name is an empty string or null, store None in session
    # so that the default model for the new provider can be picked up later if needed.
    flask_session['current_model_name'] = new_model_name if new_model_name else None
    logger.info(f"Flask session LLM settings updated: Provider={new_provider_name}, Model={flask_session['current_model_name']}")

    # If model became None after update, try to set to provider's default from LLMCore config
    if flask_session['current_model_name'] is None and llmcore_instance and llmcore_instance.config:
        provider_default_model = llmcore_instance.config.get(f"providers.{new_provider_name}.default_model")
        flask_session['current_model_name'] = provider_default_model
        logger.info(f"Model was empty or null for provider '{new_provider_name}', attempted to set to provider's default: {provider_default_model}")

    flask_session.modified = True # Ensure session is saved

    return jsonify({
        "message": "LLM settings updated in session.",
        "llm_settings": {
            "provider_name": flask_session['current_provider_name'],
            "model_name": flask_session['current_model_name'],
        }
    })


# --- System Message Settings API Endpoints ---

@settings_bp.route("/system_message", methods=["GET"])
def get_system_message_route() -> Any:
    """
    Retrieves the current system message from the Flask session.
    Accessible at GET /api/settings/system_message.
    """
    system_msg = flask_session.get('system_message', "") # Default to empty string if not set
    logger.debug(f"Retrieved system message from session: '{system_msg[:100]}...'")
    return jsonify({"system_message": system_msg})


@settings_bp.route("/system_message/update", methods=["POST"])
def update_system_message_route() -> Any:
    """
    Updates the system message for the current session in the Flask session.
    Accessible at POST /api/settings/system_message/update.
    Expects JSON payload: {"system_message": "your_new_system_message"}
    """
    data = request.json
    # Default to empty string if no data or key 'system_message' is missing
    new_system_message: str = data.get('system_message', "") if data else ""

    flask_session['system_message'] = new_system_message
    flask_session.modified = True # Ensure session is saved
    logger.info(f"Flask session system_message updated: '{new_system_message[:100]}...'")
    return jsonify({
        "message": "System message updated in session.",
        "system_message": new_system_message
    })


# --- Prompt Template Values API Endpoints ---

@settings_bp.route("/prompt_template_values", methods=["GET"])
def get_prompt_template_values_route() -> Any:
    """
    Retrieves the current RAG prompt template values from the Flask session.
    Accessible at GET /api/settings/prompt_template_values.
    """
    values = flask_session.get('prompt_template_values', {}) # Default to empty dict
    logger.debug(f"Retrieved prompt template values from session: {values}")
    return jsonify({"prompt_template_values": values})


@settings_bp.route("/prompt_template_values/update", methods=["POST"])
def update_prompt_template_value_route() -> Any:
    """
    Adds or updates a single key-value pair for RAG prompt templates in the Flask session.
    Accessible at POST /api/settings/prompt_template_values/update.
    Expects JSON payload: {"key": "string_key", "value": "string_value"}
    """
    data = request.json
    if not data or "key" not in data or "value" not in data: # Ensure both key and value are present
        logger.warning("Update prompt template value called without 'key' or 'value' in payload.")
        return jsonify({"error": "Missing 'key' or 'value' for prompt template update."}), 400

    key_to_update = str(data["key"]) # Ensure key is string
    value_to_update = str(data["value"]) # Ensure value is string

    if 'prompt_template_values' not in flask_session or not isinstance(flask_session['prompt_template_values'], dict):
        flask_session['prompt_template_values'] = {} # Initialize if not present or wrong type

    flask_session['prompt_template_values'][key_to_update] = value_to_update
    flask_session.modified = True
    logger.info(f"Prompt template value updated/added in session: {key_to_update} = '{value_to_update}'")
    return jsonify({"prompt_template_values": flask_session['prompt_template_values']})


@settings_bp.route("/prompt_template_values/delete_key", methods=["POST"])
def delete_prompt_template_value_route() -> Any:
    """
    Deletes a specific key (and its value) from RAG prompt template values in the Flask session.
    Accessible at POST /api/settings/prompt_template_values/delete_key.
    Expects JSON payload: {"key": "key_to_delete"}
    """
    data = request.json
    if not data or "key" not in data:
        logger.warning("Delete prompt template value called without 'key' in payload.")
        return jsonify({"error": "Missing 'key' for prompt template value deletion."}), 400

    key_to_delete = str(data["key"]) # Ensure key is string
    if 'prompt_template_values' in flask_session and isinstance(flask_session['prompt_template_values'], dict):
        if key_to_delete in flask_session['prompt_template_values']:
            del flask_session['prompt_template_values'][key_to_delete]
            flask_session.modified = True
            logger.info(f"Prompt template value deleted from session for key: {key_to_delete}")
        else:
            logger.warning(f"Attempted to delete non-existent prompt template key from session: {key_to_delete}")
            # Still return success as the key is not there, effectively "deleted"
    return jsonify({"prompt_template_values": flask_session.get('prompt_template_values', {})})


@settings_bp.route("/prompt_template_values/clear_all", methods=["POST"])
def clear_all_prompt_template_values_route() -> Any:
    """
    Clears all RAG prompt template values from the Flask session.
    Accessible at POST /api/settings/prompt_template_values/clear_all.
    """
    flask_session['prompt_template_values'] = {} # Reset to empty dictionary
    flask_session.modified = True
    logger.info("All prompt template values cleared from Flask session.")
    return jsonify({"prompt_template_values": {}}) # Return the new empty state

logger.info("Application settings routes (LLM, system message, prompt values) defined on settings_bp.")
