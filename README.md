# ForgeFocus AI

ForgeFocus AI helps faculty turn a syllabus into a course map, classroom-ready unit lessons, examples, and syllabus-grounded answers. It supports Gemini and OpenAI API keys, and automatically tries the other connected provider if the selected one has exhausted its quota or is temporarily unavailable.

## Run locally

```sh
clang++ -std=c++17 -pthread server.cpp -o forgefocus-ai-server
./forgefocus-ai-server
```

Open `http://127.0.0.1:8080` and keep the terminal running. Google OAuth must include this exact URL under **Authorized JavaScript origins**.

## Publish a phone-accessible demo

The project includes a Dockerfile and Render Blueprint. To publish it, push this folder to a GitHub repository, then create a Render Blueprint from that repository and deploy the `render.yaml` service. Render provides an HTTPS address that opens on phones.

Add any AI provider keys you own in the Render service environment before using AI lessons:

- `GEMINI_API_KEY` and/or `OPENAI_API_KEY` (at least one; both are recommended for automatic failover).
- `FORGEFOCUS_HOSTED=1` is set by the Blueprint.

The Google Client ID is already included in the Blueprint; it is an identifier, not a password.

Add the exact Render HTTPS origin (for example, `https://forgefocus-ai.onrender.com`) to the OAuth client's **Authorized JavaScript origins**. In Google Auth Platform > Audience, add each demo account, including the faculty member's email, as a **Test user** while the app is in testing mode. Keep OAuth external testing enabled for a small faculty demo.

The hosted server validates Google ID tokens with Google's token info endpoint before accepting AI API requests. Hosted mode does not accept provider keys through the public settings form; add them as private service environment variables instead. Google sign-in is not a substitute for provider API keys.

## Demo limitations

The Render free instance can sleep when idle, so its first request after a quiet period may take around a minute. Its local filesystem is temporary. Course maps currently stay in each signed-in account's browser storage and do not sync between devices. The AI provider keys are held as host environment variables. For long-term, multi-device course sync, add a database and deploy persistent storage.

PDF.js extracts selectable text in the browser. Image-only scanned pages use browser-side OCR; choose the scan's main language before uploading (English, Tamil, Hindi, Telugu, Kannada, Malayalam, Bengali, Marathi, Gujarati, Punjabi, Urdu, Arabic, French, or Spanish). OCR downloads its language data on first use, so the browser needs an internet connection. Clear scans work best; verify the extracted text before analysis. Extracted syllabus text is sent to the configured AI service only when Analyze, Prepare Lesson, Ask, or Make Visual is used. Provider API usage may incur charges or be limited by the provider account's quota.

Answers include language-selectable YouTube search links and can be downloaded as PDFs. These links are search suggestions, not verified or curated videos. Course maps are saved in that Google account's browser storage on the current device; they do not sync to other devices.
