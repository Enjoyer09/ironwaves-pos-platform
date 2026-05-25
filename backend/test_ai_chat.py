import sys
import logging
import os
from dotenv import load_dotenv

# Load the env vars before importing config
load_dotenv(".env")

from app.services.ai_chat import ask_help_assistant

logging.basicConfig(level=logging.INFO)

messages = [{"role": "user", "content": "Z-hesabatı necə çıxarılır?"}]
try:
    reply = ask_help_assistant(messages, "az")
    print("REPLY:", reply)
except Exception as e:
    print("EXCEPTION OUTSIDE:", e)
