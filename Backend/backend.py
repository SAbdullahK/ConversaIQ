from fastapi import FastAPI, UploadFile
from pydantic import BaseModel
from typing import List, TypedDict, Dict
from fastapi.responses import JSONResponse
from loguru import logger
from tenacity import retry, wait_fixed, stop_after_attempt, stop_after_attempt, wait_fixed, RetryError
from openrouter import OpenRouter
from sqlalchemy import create_engine, Column, INTEGER, String, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from langgraph.graph import StateGraph, START, END
import requests, os, json, io
from dotenv import load_dotenv
import anyio
# from pydub import AudioSegment

load_dotenv()
app = FastAPI()
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # your Vite dev server
    allow_methods=["*"],
    allow_headers=["*"],
)

# --------------------
# Pydantic schema
# --------------------
class CallAnalysis(BaseModel):
    overall_sentiment: str
    compliance_flags: List[str]
    crm_summary: str

# --------------------  
# Database setup
# --------------------
DATABASE_URL = "postgresql+psycopg2://postgres:abdullah@localhost:5432/callcenterdb"
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

class CallLog(Base):
    __tablename__ = "call_logs"
    id = Column(INTEGER, primary_key=True, index=True)
    transcript = Column(String)
    analysis = Column(JSON)

Base.metadata.create_all(bind=engine)

# --------------------
# LLM Client
# --------------------
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
llm_client = OpenRouter(api_key=OPENROUTER_API_KEY)
import os
import io
import uuid
import subprocess
import tempfile
import anyio
import requests
from tenacity import retry, wait_fixed, stop_after_attempt


COLAB_ASR_URL = os.getenv("COLAB_ASR_URL", "http://ixiax-34-124-217-75.a.free.pinggy.link/transcribe")

# --------------------
# CALL ASR WITH RETRIES
# --------------------
@retry(wait=wait_fixed(2), stop=stop_after_attempt(5))
def call_asr(audio_bytes: bytes) -> str:
    try:
        resp = requests.post(
            COLAB_ASR_URL,
            files={"file": ("chunk.wav", audio_bytes, "audio/wav")},
            timeout=120
        )
        resp.raise_for_status()

        data = resp.json()

        # ---- HARD SAFETY EXTRACTION ----
        if isinstance(data, dict):
            text = data.get("transcript") or data.get("text") or ""
        elif isinstance(data, str):
            text = data
        else:
            text = ""

        if not isinstance(text, str):
            text = str(text)

        return text

    except requests.exceptions.RequestException as e:
        print(f"[ERROR] ASR call failed: {e}")
        raise


# --------------------------------------------------
# EXTRA SAFE WRAPPER (RETRY INSIDE THREAD)
# --------------------------------------------------

@retry(stop=stop_after_attempt(3), wait=wait_fixed(2))
def call_asr_safe(chunk_bytes: bytes) -> str:
    return call_asr(chunk_bytes)


# --------------------------------------------------
# ASR ORIGINAL (CHUNKING + SAFE STRING HANDLING)
# --------------------------------------------------
import logging

logger = logging.getLogger(__name__)

async def asr_original(audio_bytes: bytes, format: str = "wav") -> str:
    full_transcript_parts = []
    unique_id = str(uuid.uuid4())

    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = os.path.join(tmpdir, f"input.{format}")

        # Save uploaded audio
        with open(input_path, "wb") as f:
            f.write(audio_bytes)

        output_pattern = os.path.join(tmpdir, f"{unique_id}_%03d.wav")

        ffmpeg_cmd = [
            "ffmpeg",
            "-i", input_path,
            "-f", "segment",
            "-segment_time", "15",
            "-ar", "16000",
            "-ac", "1",
            "-y",
            output_pattern
        ]

        # Run ffmpeg safely
        await anyio.to_thread.run_sync(
            lambda: subprocess.run(
                ffmpeg_cmd,
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
        )

        chunk_files = sorted(
            f for f in os.listdir(tmpdir)
            if f.startswith(unique_id) and f.endswith(".wav")
        )

        for chunk_file in chunk_files:
            chunk_path = os.path.join(tmpdir, chunk_file)

            with open(chunk_path, "rb") as f:
                chunk_bytes = f.read()

            try:
                chunk_transcript = await anyio.to_thread.run_sync(
                    call_asr_safe,
                    chunk_bytes
                )

                # ---- FINAL STRING SAFETY ----
                if not isinstance(chunk_transcript, str):
                    chunk_transcript = str(chunk_transcript)

                cleaned = chunk_transcript.strip()

                if cleaned:
                    full_transcript_parts.append(cleaned)

            except RetryError:
                print(f"[WARN] ASR failed for chunk: {chunk_file}")
                continue

    full_transcript = " ".join(full_transcript_parts)
    
    logger.debug("Full ASR transcript (debug mode):")
    logger.debug(full_transcript)
    
    # or if you want it more visible during development:
    if logging.getLogger().isEnabledFor(logging.DEBUG):
        print("\n=== DEBUG: FULL TRANSCRIPT ===")
        print(full_transcript)
        print("================================\n")

    return full_transcript
# --------------------
# Preprocess Node
# --------------------
def preprocess_transcript(transcript: str) -> str:
    return transcript.strip()

# --------------------
# LLM Node (blocking → run async)
# --------------------

# ---------------------
# Define your schema
# ---------------------
class CallAnalysis(BaseModel):
    overall_sentiment: str
    compliance_flags: List[str]
    crm_summary: str

# ---------------------
# OpenRouter API config
# ---------------------
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
HEADERS = {
    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
    "Content-Type": "application/json"
}

@retry(wait=wait_fixed(2), stop=stop_after_attempt(3))
def call_llm(cleaned_text: str) -> dict:
    base_prompt = f"""
Analyze the transcript below and return ONLY valid JSON in this exact format:

{{
"overall_sentiment": "",
"compliance_flags": [],
"crm_summary": ""
}}

Definitions:
- overall_sentiment: Positive, Neutral, or Negative
- compliance_flags: List any policy violations or risky language. Empty list if none.
- crm_summary: Short professional summary suitable for CRM entry.

Transcript:
{cleaned_text}

Do not include explanations or markdown.
Return raw JSON only.
"""

    payload = {
        "model": "mistralai/mixtral-8x7b-instruct",
        "messages": [
            {"role": "system", "content": "You are a professional call center quality analyst."},
            {"role": "user", "content": base_prompt}
        ],
        "max_tokens": 500,
        "temperature": 0.1,
        "response_format": {"type": "json_object"}
    }

    # Send request to OpenRouter
    response = requests.post(OPENROUTER_URL, headers=HEADERS, json=payload, timeout=60)
    response.raise_for_status()  # Will raise if 4xx/5xx

    data = response.json()
    raw_output = data["choices"][0]["message"]["content"]

    # Try parsing JSON
    try:
        parsed = json.loads(raw_output)
        validated = CallAnalysis(**parsed)
        return validated.dict()
    except Exception as e:
        logger.warning(f"Initial LLM JSON invalid: {e}")
        # Repair attempt
        repair_prompt = f"""
The JSON below is invalid. Please fix it to strictly match this schema:
{{
"overall_sentiment": "",
"compliance_flags": [],
"crm_summary": ""
}}
Return valid JSON only. Do not add any explanations or markdown.

Invalid JSON:
{raw_output}
"""
        repair_payload = {
            "model": "mistralai/mixtral-8x7b-instruct",
            "messages": [
                {"role": "system", "content": "You are a professional call center quality analyst."},
                {"role": "user", "content": repair_prompt}
            ],
            "max_tokens": 500,
            "temperature": 0.1,
            "response_format": {"type": "json_object"}
        }
        repair_response = requests.post(OPENROUTER_URL, headers=HEADERS, json=repair_payload, timeout=60)
        repair_response.raise_for_status()
        repaired_output = repair_response.json()["choices"][0]["message"]["content"]

        try:
            parsed_repair = json.loads(repaired_output)
            validated = CallAnalysis(**parsed_repair)
            return validated.dict()
        except Exception as e2:
            logger.error(f"LLM repair failed: {e2}")
            return {
                "overall_sentiment": "Unknown",
                "compliance_flags": [],
                "crm_summary": "LLM output invalid even after repair."
            }

# Async wrapper
import anyio

async def llm_original(cleaned_text):
    analysis = await anyio.to_thread.run_sync(call_llm, cleaned_text)
    return analysis
# --------------------
# LangGraph State
# --------------------
class State(TypedDict):
    audio_bytes: bytes
    format: str
    transcript: str
    cleaned_text: str
    analysis: Dict

# --------------------
# LangGraph Nodes
# --------------------
async def asr(state: State) -> Dict:
    transcript = await asr_original(state["audio_bytes"], state["format"])
    return {"transcript": transcript}

def preprocess(state: State) -> Dict:
    cleaned_text = preprocess_transcript(state["transcript"])
    return {"cleaned_text": cleaned_text}

async def analyze(state: State) -> Dict:
    analysis = await llm_original(state["cleaned_text"])
    return {"analysis": analysis}

async def output(state: State) -> Dict:
    # Save to DB in blocking thread to avoid blocking FastAPI
    def save_to_db():
        with SessionLocal() as session:
            call_log = CallLog(transcript=state["cleaned_text"], analysis=state["analysis"])
            session.add(call_log)
            session.commit()
    await anyio.to_thread.run_sync(save_to_db)
    return {}

# --------------------
# REST Route
# --------------------
@app.post("/process_audio")
async def process_audio(file: UploadFile):
    audio_bytes = await file.read()
    ext = os.path.splitext(file.filename)[1].lower().replace(".", "")

    # Build LangGraph
    graph = StateGraph(State)
    graph.add_node("asr", asr)
    graph.add_node("preprocess", preprocess)
    graph.add_node("analyze", analyze)
    graph.add_node("output", output)

    graph.add_edge(START, "asr")
    graph.add_edge("asr", "preprocess")
    graph.add_edge("preprocess", "analyze")
    graph.add_edge("analyze", "output")
    graph.add_edge("output", END)

    app = graph.compile()

    inputs = {"audio_bytes": audio_bytes, "format": ext}
    result = await app.ainvoke(inputs)

    response_content = {
        "transcript": result["cleaned_text"],
        "analysis": result["analysis"]
    }
    return JSONResponse(content=response_content)