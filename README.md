#  ConversaIQ  
### AI-Powered Call Center Intelligence Platform  

> Transform raw conversations into actionable insights using AI.

ConversaIQ is a full-stack AI system that converts call recordings into structured transcripts, speaker insights, and performance analytics in real time.

Built with FastAPI, React, and modern ASR pipelines.

---

## Problem

Call centers generate thousands of conversations daily.  
Manually reviewing them for quality, sentiment, and insights is slow and inefficient.

---

## Solution

ConversaIQ automatically:

- Converts audio → text (ASR)
- Extracts AI-powered insights
- Generates structured analytics
- Displays everything in a clean dashboard UI

---

## Architecture

Frontend (React)  
⬇  
FastAPI Backend  
⬇  
ASR Model  
⬇  
AI Insight Engine  
⬇  
Structured JSON Response  

---

## Core Features

- ✅ Audio file upload
- ✅ Automatic Speech Recognition (ASR)
- ✅ AI-generated summaries
- ✅ Sentiment & conversation insights
- ✅ Real-time processing
- ✅ Clean React dashboard UI
- ✅ REST API architecture

---

## Tech Stack

### Frontend
- React
- Tailwind CSS
- Axios

### Backend
- FastAPI
- Python
- Uvicorn

### AI & Processing
- ASR model integration (NVIDIA Parakeet-TDT-0.6B-v2)
- LLM-based insight generation
- Audio preprocessing pipeline

---

## How It Works

1. User uploads call audio.
2. Backend processes audio.
3. ASR converts speech → text.
4. AI model analyzes transcript.
5. Insights are returned to UI.
6. Dashboard displays results.


---

## Installation

### Clone the repo

git clone https://github.com/yourusername/ConversaIQ.git

cd ConversaIQ

### Backend setup
cd backend

python -m venv .venv

..venv\Scripts\activate

pip install -r requirements.txt

uvicorn backend:app --reload


### Frontend setup
cd frontend

npm install

npm run dev


---

## Why This Project Is Different

This is a production-ready AI Tool that makes work easier and saves millions of dollars:

- Audio engineering
- Model inference
- Backend API design
- Frontend integration
- AI-driven analytics

---

## Future Improvements

- Authentication & user accounts
- Diarization
- Cloud deployment
- Advanced analytics dashboard
- Live call streaming
- CRM integrations

---

## Author

**Syed Abdullah Kashif**  
AI & Software Engineering Enthusiast  
Building intelligent systems.

---

## ⭐ If you like this project

Give it a star. It motivates further development.
