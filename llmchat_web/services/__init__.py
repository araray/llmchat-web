# llmchat_web/services/__init__.py
"""
Services package for llmchat-web.

Contains service layer components for external API communication
and business logic abstraction.
"""

from .llmcore_api_client import LLMCoreAPIClient

__all__ = ["LLMCoreAPIClient"]
