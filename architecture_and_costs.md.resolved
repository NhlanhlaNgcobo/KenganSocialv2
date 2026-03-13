# KenganSocial: Architecture & Cost Analysis

This document provides a detailed overview of the KenganSocial web application architecture, all integrated API connections, and an estimated cost breakdown for running the platform with 50 users on the basic plan.

## 1. System Architecture Overview

The system utilizes a modern hybrid microservices architecture to balance UI responsiveness with heavy video-processing demands.

### Frontend (Client)
*   **Framework:** React 18 built with Vite
*   **State Management:** React Context API (`AuthContext`, `WorkspaceContext`)
*   **Styling:** Custom Vanilla CSS for a premium dark aesthetic
*   **Key Features:** CapCut-style local video editor timeline, Drag-and-drop mechanics, Dashboard routing via `react-router-dom`

### Primary Backend (Node.js)
*   **Framework:** Node.js with Express (Running on Port 5000)
*   **Role:** Handles all core application logic including user management, workspace administration, social media OAuth connections, analytics aggregation, and billing.
*   **Security:** Rate-limiting, CORS, Helmet, and token verification via Firebase Admin.

### Video Processing Microservice (Python)
*   **Framework:** Python FastAPI (Running on Port 8000)
*   **Role:** Handles heavy, non-blocking asynchronous tasks such as FFmpeg video rendering, Whisper transcriptions for captions, audio mixing, and Auphonic integrations.

### Database & File Storage
*   **Database:** Firebase Firestore (Serverless NoSQL) for storing users, content metadata, connections, and analytics.
*   **Authentication:** Firebase Authentication (Email/Password & Google OAuth).
*   **Storage:** Firebase Cloud Storage for raw video uploads, user avatars, and exported media.

---

## 2. Total API Connections

The application relies on several distinct internal and external APIs to function smoothly from signup to social media export.

| API Category | Service Used | Purpose |
| :--- | :--- | :--- |
| **Authentication & Auth** | Google Identity / Firebase Auth | User signup, login, Google OAuth SSO, secure JWT validation. |
| **Database & Storage** | Firebase Admin SDK | Server-to-database communication for reading/writing Firestore documents and secure bucket access for video uploads. |
| **Payment Processing** | Stripe API | Subscription management, checkout sessions, and handling webhooks for the "Basic" and "Pro" plans. |
| **Artificial Intelligence** | OpenAI API (GPT-4o) | Generating social media captions, analyzing content, and AI autocomplete. |
| **Artificial Intelligence** | Google Gemini API | Fallback/Advanced AI generation for content analysis and metadata generation. |
| **Social Media Auth & Post** | YouTube Data API v3 | Connecting channels, fetching analytics, publishing shorts/videos. |
| **Social Media Auth & Post** | Meta Graph API | Connecting Instagram and Facebook Pages, retrieving engagement analytics, and posting reels. |
| **Social Media Auth & Post** | TikTok for Developers API | Managing TikTok account connections and direct video publishing. |
| **Social Media Auth & Post** | X (Twitter) API & LinkedIn API | Text and media post syndication and analytics. |
| **Audio Processing** | Auphonic API (Optional integration) | Broadcast-grade audio mastering and normalization during the video render pipeline. |

---

## 3. Expected Costs for 50 Basic Users

For 50 active users on a "Basic Plan", the infrastructure footprint is relatively light, with the only significant variable being video rendering compute.

### A. Free/Negligible Costs
*   **Firebase Authentication:** Free (100% covered by the Spark plan).
*   **Firebase Firestore:** 50 users will easily fall under the generous free tier limits (50k reads/day, 20k writes/day). **$0/month**.
*   **Firebase Storage:** The free tier includes 5GB. 50 users processing short-form clips might exceed this slightly depending on retention policies (e.g., deleting raw files after render). Assuming careful cleanup, costs will be heavily mitigated (Storage is $0.026/GB beyond the free tier). Estimated at **$0 - $2/month**.
*   **Stripe:** Pay-per-transaction (2.9% + 30¢). No fixed monthly server costs.

### B. Fixed Infrastructure Costs
*   **Node.js Backend Server:** A standard VPS (e.g., DigitalOcean Basic Droplet, Render, or Railway) requires about 1GB - 2GB RAM to smoothly handle API traffic for 50 concurrent sessions. Estimated at **$10 - $15/month**.
*   **Python Video Microservice:** Video rendering via FFmpeg is CPU-intensive. A dedicated CPU-optimized instance (e.g., DigitalOcean CPU-Optimized or Hetzner CPX21/31) is highly recommended so that rendering doesn't freeze the main app. Estimated at **$20 - $35/month**.

### C. Variable Usage Costs
*   **OpenAI / Gemini API:** LLM generation for text/captions for 50 users is extremely cheap using current models (e.g., GPT-4o-mini). Assuming 20 API calls per user per day, this maps to roughly **$5 - $10/month**.

### 📊 Estimated Total Operational Cost
For 50 active users, expect your infrastructure and API costs to reliably range between **$35.00 to $62.00 per month**. 

*(Note: These costs scale very linearly. The bulk of the cost goes toward the server running the Python video rendering engine. If users render long 10-minute videos instead of 30-second shorts, the compute requirements for the Python server will increase).*
