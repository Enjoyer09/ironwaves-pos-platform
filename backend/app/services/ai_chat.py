import os
import logging
from app.services.opencode_service import generate_chat, default_model_id

logger = logging.getLogger(__name__)

_handbook_cache = None

def get_handbook_content() -> str:
    global _handbook_cache
    if _handbook_cache is None:
        try:
            path = os.path.join(os.path.dirname(__file__), "..", "core", "handbook_az.md")
            with open(path, "r", encoding="utf-8") as f:
                _handbook_cache = f.read()
        except Exception as e:
            logger.error(f"Failed to load handbook: {e}")
            _handbook_cache = "IronWaves POS sisteminə xoş gəlmisiniz. Qaydalar tapılmadı."
    return _handbook_cache

def ask_help_assistant(messages: list[dict], lang: str) -> str:
    handbook = get_handbook_content()
    
    system_prompt = f"""You are the official Help Assistant for IronWaves POS platform.
Your job is to answer user questions about the POS system based on the provided handbook.
Be polite, professional, and directly address the user's question.
If the question is completely unrelated to the POS system or restaurants, politely decline to answer.
Please answer in {lang.upper()}.

--- HANDBOOK ---
{handbook}
"""
    
    try:
        model = "deepseek-v4-flash-free" # Force model with large context
        response = generate_chat(
            model=model,
            messages=messages,
            system=system_prompt,
            temperature=0.3,
            max_tokens=1500
        )
        return response
    except Exception as e:
        logger.error(f"Error calling OpenCode Zen for chat: {e}")
        return f"Xəta baş verdi: {e}"
